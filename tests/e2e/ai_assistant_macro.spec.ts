import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

/**
 * End-to-end coverage for saving AI Assistant macros to the Macros panel.
 *
 * Runs in worker mode — the default runtime mode, where Pyodide lives in a
 * Dedicated Web Worker. "Save to Macros" once created the macro inside the
 * worker and announced it through a ``window`` event that does not exist
 * there, so the Macros panel never showed it. The assistant is driven by
 * the deterministic mock provider (``window.__dlwAIMock``); macros are
 * offered with ``autorun: false``, so no macro worker has to boot.
 *
 * What we cover:
 *
 *   * a macro offered by ``create_and_run_macro`` is saved and shown in
 *     the Macros panel,
 *   * the same works after a page reload, from the conversation restored
 *     from the browser history (the demo scenario of the original report),
 *     even when clicked before the Macros panel is loaded,
 *   * a Python code block written in a reply can be saved too.
 */

const CODE = [
  "import numpy as np",
  "",
  "x = np.linspace(-10, 10, 500)",
  "y = np.exp(-((np.abs(x) / 2.0) ** 8))",
  'await proxy.add_signal("Super-Gaussian", x, y)',
].join("\n");

const TOOL_MACRO_TITLE = "E2E super-Gaussian";

interface MockTurn {
  content?: string | null;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

async function setMockScript(page: Page, turns: MockTurn[]): Promise<void> {
  await page.evaluate((script) => {
    (
      window as unknown as {
        __dlwAIMock: { setScript: (turns: unknown[]) => void };
      }
    ).__dlwAIMock.setScript(script);
  }, turns);
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByLabel("AI Assistant input").fill(text);
  await page.getByRole("button", { name: /^Send$/ }).click();
}

/** Title of the active tab of the Macros panel, which must be visible. */
function activeMacroTitle(page: Page) {
  return page.locator(".macro-tab.active .macro-tab-title");
}

test.describe.serial("AI Assistant — Save to Macros (worker mode)", () => {
  test.describe.configure({ timeout: 300_000 });

  let context: Awaited<ReturnType<Browser["newContext"]>>;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));
    // Show the AI Assistant and select the mock provider before the app
    // reads its settings (re-applied on reload, which keeps IndexedDB).
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "datalab-web.aiassistant.settings",
        JSON.stringify({
          provider: "mock",
          baseUrl: "",
          model: "mock",
          temperature: 0,
          maxHistoryMessages: 0,
        }),
      );
      window.localStorage.setItem("datalab-web.aiPanelVisible", "true");
      window.localStorage.setItem("datalab-web.aiPanelCollapsed", "false");
    });
    await page.goto("/?runtime=worker");
    await waitForRuntimeReady(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("saves a macro offered by the assistant", async () => {
    await setMockScript(page, [
      {
        toolCalls: [
          {
            name: "create_and_run_macro",
            arguments: { name: TOOL_MACRO_TITLE, code: CODE, autorun: false },
          },
        ],
      },
      { content: "Here is the macro." },
    ]);
    await ask(page, "Write a macro that generates a super-gaussian curve");
    await expect(
      page.getByText(/This macro will not be executed/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: /Save to Macros/ }).click();
    await expect(page.getByRole("button", { name: /Saved ✓/ })).toBeVisible();
    await expect(activeMacroTitle(page)).toBeVisible();
    await expect(activeMacroTitle(page)).toHaveText(TOOL_MACRO_TITLE);
  });

  test("saves the macro of a conversation restored after a reload", async () => {
    // The Macros panel is loaded on demand, whereas the restored
    // conversation shows its "Save to Macros" button at once: hold the
    // panel's module until the click, so that the save has to wait for
    // the panel to load, then to restore its macros.
    let releasePanel!: () => void;
    const panelHeld = new Promise<void>((resolve) => {
      releasePanel = resolve;
    });
    const panelModule = /\/src\/components\/MacroPanel\.tsx(?:\?|$)/;
    await page.route(panelModule, async (route) => {
      await panelHeld;
      await route.continue();
    });
    try {
      await page.reload();
      await waitForRuntimeReady(page);
      // Macros live in the (unsaved) workspace: the reload dropped the one
      // saved above, while the conversation is restored from IndexedDB.
      await expect(page.getByText("Here is the macro.")).toBeVisible();
      await expect(page.locator(".macro-tab")).toHaveCount(0);
      await page.getByRole("button", { name: /Save to Macros/ }).click();
    } finally {
      releasePanel();
    }
    await expect(activeMacroTitle(page)).toBeVisible();
    await expect(activeMacroTitle(page)).toHaveText(TOOL_MACRO_TITLE);
    await page.unroute(panelModule);
  });

  test("saves a Python code block written in a reply", async () => {
    await setMockScript(page, [
      { content: ["Use this macro:", "", "```python", CODE, "```"].join("\n") },
    ]);
    const request = "Write a macro printing a super-gaussian";
    await ask(page, request);
    await expect(page.getByText("Use this macro:")).toBeVisible();
    await page
      .getByRole("button", { name: /Save to Macros/ })
      .last()
      .click();
    await expect(activeMacroTitle(page)).toBeVisible();
    await expect(activeMacroTitle(page)).toHaveText(request);
  });
});
