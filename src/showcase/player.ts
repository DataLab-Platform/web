/**
 * Showcase player: plays the selected scenarios, once or in a loop, with
 * the overlays and the operator hotkeys, and publishes its progress in
 * ``window.__showcase`` (read by the end-to-end check harness).
 *
 * Robustness for unattended kiosks: every scenario runs in a try/catch (a
 * failure is logged, a discreet notice is shown and the next demo starts
 * from a fresh workspace) and, in a loop started from the URL, the page
 * reloads every ``reloadEvery`` loops (same URL, so the showcase restarts
 * by itself with a fresh Python runtime). With ``?close=1`` (a "web
 * interlude" of DataLab desktop), a single pass ends by closing the window.
 *
 * Operator hotkeys (real keyboard only): F9 pauses/resumes; Shift+F12 stops
 * after the current demo and leaves the application to the visitors, then
 * resumes when pressed again; Esc quits (when stopped, or anytime when the
 * showcase was started from the Help menu).
 */

import "./i18n";
import { t } from "../i18n/translate";
import {
  PUBLIC_WEB_URL,
  ScenarioSkipped,
  ShowcaseAborted,
  ShowcaseContext,
  type ShowcaseScenario,
} from "./engine";
import { getShowcaseScenarios, selectScenarios } from "./index";
import {
  setShowcaseActive,
  suppressQuickstartTemplate,
  type ShowcaseHost,
} from "./launch";
import { parseShowcaseParams, type ShowcaseOptions } from "./options";
import { ShowcaseOverlay } from "./overlay";
import { PauseController, sleep } from "./pause";

export type ShowcaseState =
  "running" | "stopped" | "done" | "aborted" | "reloading" | "closing";

export interface ShowcaseResult {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  durationMs: number;
  loop: number;
}

/** Progress of the showcase, published as ``window.__showcase``. */
export interface ShowcaseStatus {
  state: ShowcaseState;
  options: ShowcaseOptions;
  loop: number;
  current: string | null;
  results: ShowcaseResult[];
}

declare global {
  interface Window {
    __showcase?: ShowcaseStatus;
  }
}

let sharedOverlay: ShowcaseOverlay | null = null;
let playing = false;

/** Time left to the browser to close the window (``?close=1``) before the
 *  showcase concludes that it refused to. */
const CLOSE_GRACE_MS = 1500;

function overlayInstance(): ShowcaseOverlay {
  sharedOverlay ??= new ShowcaseOverlay();
  return sharedOverlay;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Card covering the application while Pyodide boots (kiosk launch). */
export function showBootCard(): void {
  const overlay = overlayInstance();
  if (overlay.hasCard("boot")) return;
  overlay.mount();
  overlay.card(
    {
      kicker: t("DataLab Web · live demo"),
      title: t("Full DataLab in your browser"),
      subtitle: t(
        "Python, NumPy, SciPy, Sigima in WebAssembly — no install, no server",
      ),
      note: PUBLIC_WEB_URL,
      spinner: true,
    },
    "boot",
  );
  const timer = window.setInterval(() => {
    const status = document
      .querySelector(".app")
      ?.getAttribute("data-runtime-status");
    if (!overlay.hasCard("boot") || status === "ready") {
      window.clearInterval(timer);
    } else if (status === "error") {
      // Let the application show its error.
      window.clearInterval(timer);
      overlay.unmount();
    } else {
      const text = document.querySelector(".menubar .status")?.textContent;
      overlay.cardStatus((text ?? "").trim(), "boot");
    }
  }, 250);
}

/** Boot card of a showcase requested by the page URL (not in check mode). */
export function showUrlBootCard(): void {
  const options = parseShowcaseParams(window.location.search);
  if (options && !options.check) showBootCard();
}

/** Play the showcase requested by the page URL (kiosk launch). */
export function startUrlShowcase(
  host: ShowcaseHost,
): Promise<ShowcaseStatus | null> {
  const options = parseShowcaseParams(window.location.search);
  return options ? startShowcase(host, options) : Promise.resolve(null);
}

/**
 * Play the showcase described by ``options`` (one showcase at a time).
 * Resolves with the final status, or ``null`` if a showcase is already
 * playing.
 */
export async function startShowcase(
  host: ShowcaseHost,
  options: ShowcaseOptions,
): Promise<ShowcaseStatus | null> {
  if (playing) {
    console.warn("[showcase] a showcase is already playing");
    return null;
  }
  playing = true;
  try {
    return await new ShowcasePlayer(host, options).play();
  } finally {
    playing = false;
  }
}

class ShowcasePlayer {
  private readonly host: ShowcaseHost;
  private readonly options: ShowcaseOptions;
  private readonly overlay: ShowcaseOverlay | null;
  private readonly pause = new PauseController();
  private readonly abort = new AbortController();
  private readonly status: ShowcaseStatus;
  private stopRequested = false;
  private idle = false;

  constructor(host: ShowcaseHost, options: ShowcaseOptions) {
    this.host = host;
    this.options = options;
    this.overlay = options.check ? null : overlayInstance();
    this.status = {
      state: "running",
      options,
      loop: 0,
      current: null,
      results: [],
    };
  }

  async play(): Promise<ShowcaseStatus> {
    setShowcaseActive(true);
    suppressQuickstartTemplate();
    window.__showcase = this.status;
    const removeHotkeys = this.installHotkeys();
    const unsubscribe = this.pause.onChange(() => this.updateBadge());
    if (this.overlay) {
      this.overlay.mount();
      this.overlay.shield(true, () => this.onShieldPointer());
    }
    const ctx = new ShowcaseContext(this.host, {
      speed: this.options.speed,
      check: this.options.check,
      overlay: this.overlay,
      pause: this.pause,
      signal: this.abort.signal,
    });
    let reloading = false;
    let closing = false;
    try {
      const all = await getShowcaseScenarios(ctx);
      const { scenarios, unknown } = selectScenarios(all, this.options.ids);
      for (const id of unknown) {
        ctx.log(`unknown scenario "${id}"`);
        this.status.results.push({
          id,
          title: id,
          status: "failed",
          error: `Unknown showcase scenario "${id}"`,
          durationMs: 0,
          loop: 1,
        });
      }
      // Warm up behind the boot card (kiosk launch), so that no demo starts
      // with a cold Python worker.
      this.overlay?.cardStatus(t("Preparing the demos…"), "boot");
      await this.prewarm(ctx, scenarios);
      await this.overlay?.clearCard(600, "boot");
      for (let loop = 1; scenarios.length > 0; loop++) {
        this.status.loop = loop;
        for (const scenario of scenarios) {
          await this.playScenario(ctx, scenario, loop);
          if (this.stopRequested) await this.waitWhileStopped(ctx);
        }
        // A window closing after this pass keeps its end card until it goes.
        await ctx.endCard(5000, { keep: this.options.close });
        if (!this.options.loop) break;
        const { fromUrl, reloadEvery } = this.options;
        if (fromUrl && reloadEvery > 0 && loop % reloadEvery === 0) {
          // Same URL: the showcase restarts with a fresh Python runtime.
          reloading = true;
          this.status.state = "reloading";
          window.location.reload();
          return this.status;
        }
      }
      this.status.state = "done";
      if (this.options.close) {
        closing = true;
        await this.closeWindow(ctx);
      }
    } catch (error) {
      if (error instanceof ShowcaseAborted) {
        this.status.state = "aborted";
      } else {
        console.error("[showcase] stopped by an error", error);
        this.status.results.push({
          id: "showcase",
          title: "showcase",
          status: "failed",
          error: errorMessage(error),
          durationMs: 0,
          loop: this.status.loop,
        });
        this.status.state = "done";
      }
    } finally {
      removeHotkeys();
      unsubscribe();
      this.status.current = null;
      // A window that the browser refused to close keeps its end state.
      if (!reloading && !(closing && this.status.state === "done")) {
        this.overlay?.unmount();
        setShowcaseActive(false);
        if (!this.options.fromUrl && document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        }
      }
    }
    return this.status;
  }

  /**
   * ``?close=1`` (web interlude): close the window after its single pass,
   * its end card still shown. A browser closes by script only the windows
   * that a script opened or that have a single history entry (e.g. an
   * app window opened with ``--app=<url>``); when it refuses, the end card
   * stays with a discreet "You can close this window" badge.
   */
  private async closeWindow(ctx: ShowcaseContext): Promise<void> {
    this.status.state = "closing";
    ctx.log("closing the window");
    window.close();
    await sleep(CLOSE_GRACE_MS, this.abort.signal);
    ctx.log("the browser kept the window open");
    this.status.state = "done";
    this.overlay?.setMode("idle");
    this.overlay?.badge(t("You can close this window."), "idle");
  }

  private async prewarm(
    ctx: ShowcaseContext,
    scenarios: ShowcaseScenario[],
  ): Promise<void> {
    for (const scenario of scenarios) {
      if (!scenario.prewarm) continue;
      ctx.beginScenario(scenario);
      try {
        await scenario.prewarm(ctx);
      } catch (error) {
        if (error instanceof ShowcaseAborted) throw error;
        if (error instanceof ScenarioSkipped) continue;
        console.warn(`[showcase] prewarm of "${scenario.id}" failed`, error);
        if (this.options.check) {
          this.status.results.push({
            id: `${scenario.id}:prewarm`,
            title: scenario.title(),
            status: "failed",
            error: errorMessage(error),
            durationMs: 0,
            loop: 0,
          });
        }
      } finally {
        ctx.endScenario();
      }
    }
  }

  private async playScenario(
    ctx: ShowcaseContext,
    scenario: ShowcaseScenario,
    loop: number,
  ): Promise<void> {
    const started = performance.now();
    const result: ShowcaseResult = {
      id: scenario.id,
      title: scenario.title(),
      status: "passed",
      durationMs: 0,
      loop,
    };
    this.status.current = scenario.id;
    ctx.beginScenario(scenario);
    try {
      // The workspace is reset behind the title card.
      await ctx.titleCard(scenario.title(), scenario.subtitle?.(), 3000, () =>
        ctx.resetWorkspace(),
      );
      await scenario.run(ctx);
    } catch (error) {
      if (error instanceof ShowcaseAborted) throw error;
      result.error = errorMessage(error);
      if (error instanceof ScenarioSkipped) {
        result.status = "skipped";
        ctx.log(`skipped: ${result.error}`);
      } else {
        result.status = "failed";
        console.error(`[showcase] scenario "${scenario.id}" failed`, error);
        if (!ctx.check) {
          await ctx
            .notice(t("This demo hit a snag — moving on to the next one."))
            .catch(() => undefined);
        }
      }
    } finally {
      ctx.endScenario();
      result.durationMs = Math.round(performance.now() - started);
      this.status.results.push(result);
      this.status.current = null;
    }
  }

  /** Shift+F12: leave the application to the visitors until pressed again
   *  (or Esc quits). */
  private async waitWhileStopped(ctx: ShowcaseContext): Promise<void> {
    this.idle = true;
    this.status.state = "stopped";
    ctx.clearCaption();
    ctx.clearSpotlight();
    this.overlay?.shield(false);
    this.overlay?.setMode("idle");
    this.updateBadge();
    ctx.log("stopped (Shift+F12 resumes, Esc quits)");
    try {
      while (this.stopRequested) await sleep(250, this.abort.signal);
    } finally {
      this.idle = false;
    }
    this.status.state = "running";
    this.overlay?.setMode("autoplay");
    this.overlay?.shield(true, () => this.onShieldPointer());
    this.updateBadge();
    ctx.log("resuming");
  }

  private installHotkeys(): () => void {
    const handler = (event: KeyboardEvent) => {
      // Only the operator's real keyboard: the scenarios' own (synthetic)
      // key presses must not drive the player.
      if (!event.isTrusted) return;
      if (event.key === "F9" && !event.ctrlKey && !event.altKey) {
        this.pause.toggle();
      } else if (event.key === "F12" && event.shiftKey) {
        this.stopRequested = !this.stopRequested;
        this.updateBadge();
      } else if (
        event.key === "Escape" &&
        (this.idle || !this.options.fromUrl)
      ) {
        this.abort.abort();
      } else {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }

  private updateBadge(): void {
    if (!this.overlay) return;
    if (this.pause.isPaused) {
      this.overlay.badge(t("Paused — F9 to resume"), "pause");
    } else if (this.idle) {
      this.overlay.badge(
        t("Showcase stopped — Shift+F12 to resume, Esc to quit"),
        "idle",
      );
    } else if (this.stopRequested) {
      this.overlay.badge(t("Stopping after this demo — Shift+F12 to cancel"));
    } else {
      this.overlay.badge(null);
    }
  }

  /** A visitor touched the screen while a demo plays. */
  private onShieldPointer(): void {
    if (!this.overlay || this.pause.isPaused || this.stopRequested) return;
    this.overlay.badge(
      this.options.fromUrl
        ? t("Live demo in progress — Shift+F12 to take over")
        : t("Live demo in progress — Esc to quit, Shift+F12 to take over"),
      "info",
      3500,
    );
  }
}
