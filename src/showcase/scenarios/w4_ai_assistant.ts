import { setProviderOverride } from "../../aiassistant/provider";
import { MACRO_TOOL_NAME } from "../../aiassistant/tools";
import type { ChatMessage } from "../../aiassistant/types";
import { t } from "../../i18n/translate";
import {
  isVisible,
  ShowcaseAborted,
  type ShowcaseContext,
  type ShowcaseScenario,
} from "../engine";
import {
  AIAssistantStateGuard,
  lastToolOutput,
  lastToolResult,
  ReplayProvider,
  type ReplayTurn,
} from "./w4_replay";
import { waitForKernel } from "./w2_kernel";

/**
 * W4 — AI assistant (replayed session).
 *
 * The visitor's request is typed in the AI Assistant, which proposes a
 * macro (``create_and_run_macro``); the showcase approves it, the macro
 * really runs (noisy Gaussian, Gaussian fit computed by DataLab, FWHM) and
 * the assistant sums up the real result. A follow-up request shows a
 * read-only tool running at once (``list_signals``), then a processing
 * (``apply_processing``, moving average) waiting for approval.
 *
 * Only the assistant's answers are scripted (:class:`ReplayProvider`, in
 * memory: no network, the user's AI settings are neither read nor
 * changed), which a permanent label states on screen. The user's AI
 * Assistant state (panel, input and conversation histories) is restored
 * afterwards, see :class:`AIAssistantStateGuard`.
 */

const PANEL = '[data-testid="ai-assistant-panel"]';
const PANEL_TIMEOUT_MS = 10_000;
/** The macro worker may still be booting (cold browser cache). */
const RUN_TIMEOUT_MS = 120_000;
/** Boot of the macro worker during the warm-up. */
const PREWARM_TIMEOUT_MS = 180_000;
/** Warm-up: how long to let the notebook kernel boot first. */
const KERNEL_WAIT_MS = 90_000;

// -- Replayed conversation ---------------------------------------------------------

function noisyTitle(): string {
  return t("Noisy Gaussian");
}

function fitMacro(): string {
  return [
    "import numpy as np",
    "",
    `# ${t("Noisy Gaussian signal (reproducible noise)")}`,
    "x = np.linspace(-10, 10, 2001)",
    "rng = np.random.default_rng(42)",
    "y = 2.5 * np.exp(-0.5 * ((x - 1) / 1.6) ** 2) + rng.normal(0, 0.08, x.size)",
    `sig = await proxy.add_signal("${noisyTitle()}", x, y)`,
    "",
    `# ${t("Gaussian fit, computed by DataLab")}`,
    'fit = (await proxy.calc("gaussian_fit", sources=[sig]))[0]',
    "",
    `# ${t("FWHM of the fitted curve")}`,
    "xy = await proxy.get_signal_xy(fit)",
    'xf, yf = np.array(xy["x"]), np.array(xy["y"])',
    "above = xf[yf >= (yf.max() + yf.min()) / 2]",
    'print(f"FWHM = {above[-1] - above[0]:.2f}")',
  ].join("\n");
}

/** Assistant turns; ``found`` receives the FWHM printed by the macro. */
function replayScript(found: (fwhm: string | null) => void): ReplayTurn[] {
  return [
    {
      thinkMs: 2200,
      content: t(
        "Sure! I will write a macro that creates the noisy signal, fits a Gaussian with DataLab and measures its full width at half maximum.",
      ),
      toolCalls: [
        {
          name: MACRO_TOOL_NAME,
          arguments: { name: t("Noisy Gaussian fit"), code: fitMacro() },
        },
      ],
    },
    {
      thinkMs: 2000,
      content: (messages) => {
        const fwhm = /FWHM = ([\d.]+)/.exec(lastToolOutput(messages))?.[1];
        found(fwhm ?? null);
        return fwhm
          ? t(
              "Done! The noisy Gaussian and its fit are now in the Signals panel. The fitted curve has a full width at half maximum of **{fwhm}**.",
              { fwhm },
            )
          : t(
              "The macro did not report the full width at half maximum: see its output above.",
            );
      },
    },
    // Follow-up request: a read-only query, then a dedicated processing.
    {
      thinkMs: 1500,
      toolCalls: [{ name: "list_signals", arguments: {} }],
    },
    {
      thinkMs: 1500,
      content: (messages) =>
        noisySignalId(messages)
          ? t("I will smooth “{title}” with a 25-point moving average.", {
              title: noisyTitle(),
            })
          : t("I could not find the noisy signal."),
      toolCalls: (messages) => {
        const id = noisySignalId(messages);
        return id
          ? [
              {
                name: "apply_processing",
                arguments: {
                  id,
                  processing_id: "moving_average",
                  params: { n: 25 },
                },
              },
            ]
          : [];
      },
    },
    {
      thinkMs: 1200,
      content: t(
        "Done: the smoothed signal is in the Signals panel, next to the noisy one.",
      ),
    },
  ];
}

/** Id of the noisy signal in the last ``list_signals`` result. */
function noisySignalId(messages: ChatMessage[]): string | null {
  const signals = lastToolResult(messages);
  if (!Array.isArray(signals)) return null;
  const match = (signals as Array<{ id?: unknown; title?: unknown }>).find(
    (signal) => signal.title === noisyTitle(),
  );
  return typeof match?.id === "string" ? match.id : null;
}

// -- DOM helpers ---------------------------------------------------------------------

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(PANEL);
}

function buttonIn(
  root: Element | null | undefined,
  selector: string,
  match: (button: HTMLButtonElement) => boolean,
): HTMLButtonElement | null {
  if (!root) return null;
  return (
    [...root.querySelectorAll<HTMLButtonElement>(selector)].find(
      (button) => isVisible(button) && match(button),
    ) ?? null
  );
}

function byText(text: string) {
  return (button: HTMLButtonElement) =>
    (button.textContent ?? "").trim() === text;
}

function byLabel(label: string) {
  return (button: HTMLButtonElement) =>
    button.getAttribute("aria-label") === label;
}

/** The assistant is answering (its Stop button replaces Send). */
function isBusy(): boolean {
  return buttonIn(panel(), ".ai-input button", byText(t("Stop"))) !== null;
}

function bubbleCount(): number {
  return panel()?.querySelectorAll(".ai-bubble").length ?? 0;
}

function lastAnswer(): HTMLElement | null {
  const answers = panel()?.querySelectorAll<HTMLElement>(
    ".ai-bubble-assistant:not(.ai-bubble-streaming)",
  );
  return answers && answers.length > 0 ? answers[answers.length - 1] : null;
}

function treeTitles(ctx: ShowcaseContext): string[] {
  return ctx
    .$$(".object-tree-item .object-tree-title")
    .map((el) => (el.textContent ?? "").trim());
}

/** Show the AI Assistant panel (expanded); true if it was hidden. */
async function openPanel(ctx: ShowcaseContext): Promise<boolean> {
  if (ctx.visible(PANEL)) return false;
  const pill = ctx.visible(".ai-floating-pill");
  await ctx.click(pill ?? ".menubar-ai-toggle");
  await ctx.waitFor(PANEL, PANEL_TIMEOUT_MS);
  return true;
}

/** Start from an empty conversation (the panel restores the latest one
 *  when it opens; it stays untouched in the history). */
async function newConversation(
  ctx: ShowcaseContext,
  restoring: boolean,
): Promise<void> {
  if (restoring) {
    try {
      await ctx.waitFor(() => bubbleCount() > 0, 5_000);
    } catch (error) {
      if (error instanceof ShowcaseAborted) throw error;
    }
  }
  if (bubbleCount() > 0) {
    await ctx.click(() =>
      buttonIn(
        panel(),
        ".ai-panel-header button",
        byLabel(t("New conversation")),
      ),
    );
    await ctx.waitFor(() => bubbleCount() === 0, 5_000, "a new conversation");
  }
  await ctx.checkpoint(
    () => bubbleCount() === 0 && !isBusy(),
    "the AI Assistant starts a new, empty conversation",
  );
}

/** Type ``text`` in the assistant input, as a visitor would, and send it. */
async function ask(ctx: ShowcaseContext, text: string): Promise<void> {
  const input = (await ctx.find(
    `${PANEL} .ai-input textarea`,
  )) as HTMLTextAreaElement;
  input.setSelectionRange(0, input.value.length);
  await ctx.type(input, text, 14);
  await ctx.hold(800);
  await ctx.click(() =>
    buttonIn(
      panel(),
      ".ai-input button",
      (button) => byText(t("Send"))(button) && !button.disabled,
    ),
  );
}

/** Wait for the approval dialog of ``tool``, explain it, then approve. */
async function approve(
  ctx: ShowcaseContext,
  tool: string,
  caption: string,
): Promise<void> {
  const dialog = await ctx.find(".ai-tool-confirm-dialog", 60_000);
  await ctx.checkpoint(
    () => (dialog.textContent ?? "").includes(tool),
    `the assistant asks to approve ${tool}`,
  );
  await ctx.hold(600);
  await ctx.spotlight(dialog);
  await ctx.say(caption, 4500);
  // The caption would hide the dialog buttons.
  ctx.clearCaption();
  await ctx.hold(700);
  ctx.clearSpotlight();
  await ctx.click(() =>
    buttonIn(dialog, ".actions button", byText(t("Approve"))),
  );
}

/** Plot every signal (select their group) under a spotlight. */
async function showGroup(ctx: ShowcaseContext): Promise<void> {
  await ctx.click(".object-tree-group > :first-child");
  await ctx.hold(800);
  await ctx.spotlight(".plot-area");
}

// -- Clean-up without the showcase context (also after an abort) -------------------

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function poll(probe: () => unknown, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() >= deadline) return false;
    await pause(50);
  }
}

function panelShown(): boolean {
  return (
    panel() !== null || document.querySelector(".ai-floating-pill") !== null
  );
}

/** Hide or show the panel with the menu bar toggle. */
async function setPanelShown(shown: boolean): Promise<void> {
  if (panelShown() === shown) return;
  document.querySelector<HTMLElement>(".menubar-ai-toggle")?.click();
  await poll(() => panelShown() === shown, 3_000);
}

/** Stop the replayed session and give the user's AI Assistant back as it
 *  was. */
async function restoreAssistant(
  guard: AIAssistantStateGuard,
  sent: boolean,
): Promise<void> {
  if (isBusy()) {
    // Also rejects a pending tool approval: no further provider call.
    buttonIn(panel(), ".ai-input button", byText(t("Stop")))?.click();
    await poll(() => !isBusy(), 30_000);
  }
  setProviderOverride(null);
  await setPanelShown(false);
  if (sent) {
    // The panel saves the conversation once the answer is complete.
    await poll(async () => (await guard.newConversations()).length > 0, 5_000);
  }
  await guard.restore();
  if (guard.panelVisible) {
    await setPanelShown(true);
    if (guard.panelCollapsed) {
      buttonIn(
        panel(),
        ".ai-panel-header button",
        byLabel(t("Minimise AI Assistant")),
      )?.click();
      await poll(() => document.querySelector(".ai-floating-pill"), 3_000);
    }
    guard.restoreStorage();
  }
}

// -- Scenario ------------------------------------------------------------------------

export const w4AiAssistant: ShowcaseScenario = {
  id: "w4",
  title: () => t("AI assistant (replayed session)"),
  subtitle: () => t("Ask in plain language, DataLab does the processing"),

  async prewarm(ctx) {
    // Boot the Python worker that runs the assistant's macros, once the
    // notebook kernel is up: the Pyodide packages then come from the
    // browser cache rather than from concurrent downloads.
    try {
      await waitForKernel(ctx, KERNEL_WAIT_MS);
    } catch (error) {
      if (error instanceof ShowcaseAborted) throw error;
    }
    let done: { error?: unknown } | null = null;
    ctx.host.runtime.runMacroCode("pass", "Showcase warm-up").then(
      () => (done = {}),
      (error: unknown) => (done = { error }),
    );
    const outcome = await ctx.waitFor(
      () => done,
      PREWARM_TIMEOUT_MS,
      "the macro worker to be ready",
    );
    if (outcome.error) throw outcome.error;
  },

  async run(ctx) {
    ctx.label(t("Replayed session — simulated AI provider"));
    const guard = await AIAssistantStateGuard.capture();
    let fwhm: string | null = null;
    const replay = new ReplayProvider(
      replayScript((value) => {
        fwhm = value;
      }),
      ctx,
    );
    setProviderOverride(replay);
    let sent = false;
    try {
      await ctx.say(
        t("The AI assistant drives DataLab with the same actions as you."),
      );
      const opened = await openPanel(ctx);
      await newConversation(ctx, opened && guard.hasConversations);
      await ctx.say(t("This session is replayed: no data leaves the booth."));

      // The request, typed by the "visitor".
      sent = true;
      await ask(
        ctx,
        t("Create a noisy Gaussian signal, fit it and give me its FWHM"),
      );

      // The assistant proposes a macro: nothing runs before approval.
      await approve(
        ctx,
        MACRO_TOOL_NAME,
        t(
          "Nothing runs without your approval: the proposed macro is shown first.",
        ),
      );
      await ctx.say(
        t(
          "Approved: the macro runs in DataLab's Python sandbox, on real data.",
        ),
      );

      // The macro really ran: its objects, then the assistant's summary.
      await ctx.checkpoint(
        () =>
          treeTitles(ctx).includes(noisyTitle()) &&
          treeTitles(ctx).some((title) => title.startsWith("gaussian_fit(")),
        "the noisy signal and its Gaussian fit are in the Signals panel",
        RUN_TIMEOUT_MS,
      );
      await ctx.checkpoint(
        () => replay.answered === 2 && !isBusy() && lastAnswer(),
        "the assistant answers once the macro has run",
        RUN_TIMEOUT_MS,
      );
      await ctx.checkpoint(
        () => fwhm !== null && (lastAnswer()?.textContent ?? "").includes(fwhm),
        "the answer quotes the FWHM measured by the macro",
      );

      // The agent loop: the macro output went back to the assistant.
      await ctx.spotlight(() => panel()?.querySelector(".ai-bubble-tool"));
      await ctx.say(
        t(
          "The macro output goes back to the assistant, which reads the measured value.",
        ),
        3500,
      );
      await ctx.spotlight(() => lastAnswer());
      await ctx.hold(3000);
      ctx.clearSpotlight();

      // Plot both curves (select their group).
      await showGroup(ctx);
      await ctx.say(
        t(
          "Real results: the noisy signal, its Gaussian fit and the measured FWHM.",
        ),
        4000,
      );
      ctx.clearSpotlight();

      // Follow-up: a read-only query runs at once, a processing asks first.
      await ask(ctx, t("Now smooth the noisy signal with a moving average"));
      await approve(
        ctx,
        "apply_processing",
        t(
          "Read-only queries run at once; any change still waits for your approval.",
        ),
      );
      await ctx.checkpoint(
        () => treeTitles(ctx).length === 3,
        "the smoothed signal is in the Signals panel",
        RUN_TIMEOUT_MS,
      );
      await ctx.checkpoint(
        () => replay.answered === 5 && !isBusy(),
        "the assistant answers once the signal is smoothed",
        RUN_TIMEOUT_MS,
      );
      await ctx.hold(1500);
      await showGroup(ctx);
      await ctx.hold(2500);
      ctx.clearSpotlight();
      await ctx.say(
        t("Bring your own model: OpenAI or a local LLM (Ollama, LM Studio…)."),
        4000,
      );
      await ctx.click(() =>
        buttonIn(
          panel(),
          ".ai-panel-header button",
          byLabel(t("Hide AI Assistant")),
        ),
      );
    } finally {
      ctx.clearSpotlight();
      await restoreAssistant(guard, sent);
      ctx.label(null);
    }
  },
};
