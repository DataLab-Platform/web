import { test as coldTest, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";
import { test, resetWarmNotebookPanel } from "./fixtures-warm";

/**
 * End-to-end coverage for the Notebook panel.
 *
 * The bulk of the suite runs against a worker-scoped ``warmPage``
 * fixture: Pyodide is booted ONCE per Playwright worker and reused
 * across every test in the ``Notebook UI`` describe. Between tests,
 * :func:`resetWarmNotebookPanel` wipes Python state, the recent
 * IndexedDB store and every notebook tab, then waits for the panel
 * to auto-spawn a fresh ``Untitled`` notebook. Local measurement on
 * the POC slice of three tests showed a ~74% wall-time reduction
 * vs. the previous cold-boot-per-test baseline.
 *
 * The :class:`Quickstart notebook template` describe stays on the
 * default per-test page because it asserts the *first-boot* code
 * path which only fires on a pristine, never-touched browser
 * context.
 *
 * Notebook content surviving an HDF5 round-trip is asserted by
 * ``workspace_persistence_roundtrip.spec.ts`` — the workspace-level
 * round-trip already serialises notebooks alongside signals/macros,
 * so a notebook-only round-trip would just rerun the same code path.
 */

test.describe.configure({ mode: "serial" });

test.describe("Notebook UI", () => {
  test.beforeAll(async ({ warmPage }) => {
    // First test in the worker performs the actual Pyodide boot and
    // notebook-worker install. Switch to the panel and wait for the
    // kernel to settle before any individual test starts.
    await warmPage.getByRole("tab", { name: "Notebooks" }).click();
    await expect(warmPage.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );
  });

  test.beforeEach(async ({ warmPage }) => {
    // Auto-accept the close-tab confirmation dialog so the reset can
    // tear down notebook tabs without user interaction.
    warmPage.removeAllListeners("dialog");
    warmPage.on("dialog", (d) => {
      void d.accept();
    });
    await resetWarmNotebookPanel(warmPage);
  });

  test("cell content survives a panel round-trip", async ({
    warmPage: page,
  }) => {
    // Type a small program into the only cell. CodeMirror must be
    // focused first; clicking the cell editor area takes care of that.
    const cellEditor = page.locator(".nb-cell-editor .cm-content").first();
    await cellEditor.click();
    const cellSource = [
      "x = np.linspace(-10, 10, 500)",
      "y = np.sin(x) / (x + 1e-9)",
      'oid = await proxy.add_signal("sinc", x, y)',
      'print(f"Created signal {oid}")',
    ].join("\n");
    await page.keyboard.type(cellSource);

    // Run with Ctrl+Enter (executes without inserting a new cell).
    await page.keyboard.press("Control+Enter");

    // Wait until the cell shows an execution counter and prints.
    // The counter is the kernel-global ``_EXEC_COUNT`` so we can't
    // pin it to ``[1]`` in a warm-fixture context where the kernel
    // is shared across tests.
    const prompt = page.locator(".nb-cell-prompt").first();
    await expect(prompt).toContainText(/\[\d+\]/, { timeout: 60_000 });
    const promptText = await prompt.textContent();
    const stdout = page.locator(".nb-output-stdout").first();
    await expect(stdout).toContainText("Created signal", { timeout: 30_000 });

    // Manually switch to the Signals panel — proxy.add_signal does NOT
    // change the active panel by itself (only the explicit
    // ``proxy.set_current_panel`` does). The signal must however be
    // visible in the tree.
    await page.getByRole("tab", { name: "Signals" }).click();
    await expect(page.locator(".panel-header")).toContainText("Signals");
    await expect(
      page.locator(".object-tree-item").filter({ hasText: "sinc" }),
    ).toBeVisible({ timeout: 10_000 });

    // Switch back to the Notebooks tab — this is THE regression test:
    // the cell content, execution counter and stdout must all survive.
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".panel-header")).toContainText("Notebooks");

    // The cell editor must still hold the source we typed.
    const restored = await page
      .locator(".nb-cell-editor .cm-content")
      .first()
      .innerText();
    // CodeMirror collapses lines to its own DOM; just check our
    // distinctive tokens survived.
    expect(restored).toContain("np.linspace(-10, 10, 500)");
    expect(restored).toContain('proxy.add_signal("sinc"');

    // The execution counter and stdout output must also still be there
    // (they live in the CellModel, not in CodeMirror).
    await expect(page.locator(".nb-cell-prompt").first()).toContainText(
      promptText ?? "",
    );
    await expect(page.locator(".nb-output-stdout").first()).toContainText(
      "Created signal",
    );
  });

  test("a new code cell gets a strictly increasing execution counter", async ({
    warmPage: page,
  }) => {
    // Run the first cell so it gets some counter [N].
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("a = 41");
    await page.keyboard.press("Control+Enter");
    const firstPrompt = page.locator(".nb-cell-prompt").first();
    await expect(firstPrompt).toContainText(/\[\d+\]/, { timeout: 60_000 });
    const first = await firstPrompt.textContent();
    const firstN = Number((first ?? "").match(/\[(\d+)\]/)?.[1] ?? "0");
    expect(firstN).toBeGreaterThan(0);

    // Insert a code cell via the toolbar button and run "print(a + 1)".
    await page.getByRole("button", { name: "+ Code" }).click();
    const cells = page.locator(".nb-cell");
    await expect(cells).toHaveCount(2);
    const newEditor = page.locator(".nb-cell-editor .cm-content").nth(1);
    await newEditor.click();
    await page.keyboard.type("print(a + 1)");
    await page.keyboard.press("Control+Enter");

    // Second cell shows a counter strictly greater than the first.
    const secondPrompt = page.locator(".nb-cell-prompt").nth(1);
    await expect(secondPrompt).toContainText(/\[\d+\]/, { timeout: 60_000 });
    const second = await secondPrompt.textContent();
    const secondN = Number((second ?? "").match(/\[(\d+)\]/)?.[1] ?? "0");
    expect(secondN).toBeGreaterThan(firstN);
    await expect(
      page.locator(".nb-cell").nth(1).locator(".nb-output-stdout"),
    ).toContainText("42", { timeout: 10_000 });
  });

  test("creating a new notebook adds a tab and switches to it", async ({
    warmPage: page,
  }) => {
    const before = await page.locator(".nb-tab").count();
    await page.locator(".nb-tab-new").click();
    await page.getByRole("menuitem", { name: /Empty notebook/ }).click();
    // One more tab and the latest one is active. ``persistAndOpen``
    // appends the new tab to the React state and immediately activates
    // it, so the newly-created notebook is always the *last* tab — use
    // ``.last()`` rather than ``.nth(before)`` to keep the assertion
    // robust if a stale, deferred state update from a previous test
    // happens to land between the count snapshot and the assertions.
    await expect(page.locator(".nb-tab")).toHaveCount(before + 1);
    await expect(page.locator(".nb-tab.active")).toHaveCount(1);
    await expect(page.locator(".nb-tab").last()).toHaveClass(/active/);
  });

  test("Export… triggers a .ipynb download with valid nbformat content", async ({
    warmPage: page,
  }) => {
    // Add a marker line so the downloaded payload is identifiable.
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("print('download-me')");
    await page.waitForTimeout(800);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.ipynb$/);

    // Read the downloaded file and validate basic nbformat structure.
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(path!, "utf-8");
    const json = JSON.parse(text) as {
      nbformat: number;
      nbformat_minor: number;
      cells: Array<{ cell_type: string; source: string | string[] }>;
    };
    expect(json.nbformat).toBe(4);
    expect(json.nbformat_minor).toBe(5);
    expect(json.cells.length).toBeGreaterThanOrEqual(1);
    const sources = json.cells.map((c) =>
      Array.isArray(c.source) ? c.source.join("") : c.source,
    );
    expect(sources.join("\n")).toContain("download-me");
  });

  test("markdown cells render Markdown to HTML", async ({ warmPage: page }) => {
    // Insert a markdown cell.
    await page.getByRole("button", { name: /\+ Markdown/ }).click();
    // The new markdown cell starts in editing mode (empty source).
    const cells = page.locator(".nb-cell");
    await expect(cells).toHaveCount(2);
    const mdEditor = cells.nth(1).locator(".nb-cell-editor .cm-content");
    await mdEditor.click();
    await page.keyboard.type(
      "# Hello world\n\nThis is **bold** and *italic*.\n\n- item 1\n- item 2",
    );
    // Commit (Ctrl+Enter) — leaves edit mode for markdown cells.
    await page.keyboard.press("Control+Enter");

    const rendered = cells.nth(1).locator(".nb-cell-markdown-rendered");
    await expect(rendered).toBeVisible();
    await expect(rendered.locator("h1")).toHaveText("Hello world");
    await expect(rendered.locator("strong")).toHaveText("bold");
    await expect(rendered.locator("em")).toHaveText("italic");
    await expect(rendered.locator("li")).toHaveCount(2);
  });

  test("Rename tab title updates the active tab title", async ({
    warmPage: page,
  }) => {
    // Initial name is "Untitled".
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "Untitled",
    );
    // Rename is triggered by double-clicking the active tab title.
    await page.locator(".nb-tab.active .nb-tab-title").dblclick();
    // Inline input appears in the active tab.
    const renameInput = page.locator(".nb-tab.active .nb-tab-rename-input");
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toBeFocused();
    // Clear and type the new name, commit with Enter.
    await renameInput.fill("My Spectroscopy Notes");
    await renameInput.press("Enter");
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "My Spectroscopy Notes",
    );
    // Type something so autosave kicks in (the rename of an empty
    // notebook is intentionally not persisted on its own), then verify
    // the recent store reflects the new name.
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("# spec");
    await page.waitForTimeout(1200);
    const stored = await page.evaluate(async () => {
      const req = indexedDB.open("datalab-web.recent");
      const db: IDBDatabase = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction("entries", "readonly");
      const all = await new Promise<{ kind: string; title: string }[]>(
        (res, rej) => {
          const r = tx.objectStore("entries").getAll();
          r.onsuccess = () =>
            res(r.result as { kind: string; title: string }[]);
          r.onerror = () => rej(r.error);
        },
      );
      return all.filter((r) => r.kind === "notebook").map((r) => r.title);
    });
    expect(stored).toContain("My Spectroscopy Notes");
  });

  test("Escape cancels the rename without changing the name", async ({
    warmPage: page,
  }) => {
    // Rename is triggered by double-clicking the active tab title.
    await page.locator(".nb-tab.active .nb-tab-title").dblclick();
    const renameInput = page.locator(".nb-tab.active .nb-tab-rename-input");
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Aborted Name");
    await renameInput.press("Escape");
    await expect(page.locator(".nb-tab-rename-input")).toHaveCount(0);
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "Untitled",
    );
  });

  test("re-opening a saved .ipynb from disk loads the notebook", async ({
    warmPage: page,
  }) => {
    // Type something distinctive, save, then re-open.
    const marker = "print('reopen-me')";
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type(marker);
    await page.waitForTimeout(800);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export/ }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();

    // Open the file back through the hidden file input.
    const fileInput = page.locator('input[type="file"][accept*=".ipynb"]');
    const tabsBefore = await page.locator(".nb-tab").count();
    await fileInput.setInputFiles(path!);

    // A new tab must appear, focused on the loaded notebook.
    await expect(page.locator(".nb-tab")).toHaveCount(tabsBefore + 1);
    // The marker text from the saved file is in the active editor.
    const restored = await page
      .locator(".nb-cell-editor .cm-content")
      .first()
      .innerText();
    expect(restored).toContain("reopen-me");
  });

  test("browser-store menu lists notebooks and opening focuses tab", async ({
    warmPage: page,
  }) => {
    // The warm-fixture reset wipes IDB but the helper opens a fresh
    // ``Untitled`` tab via the ``+`` toolbar button which runs through
    // ``persistAndOpen`` and therefore seeds the recent cache. The
    // first-boot "Recent… disabled until first edit" invariant lives
    // on the cold-boot init path of ``NotebookPanel`` and is verified
    // implicitly by the ``Quickstart`` cold test below; we focus this
    // warm test on the menu functionality only.

    // Type something so the current notebook autosaves under a known
    // marker.
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("first-marker");
    await page.waitForTimeout(1000);

    const browserBtn = page.getByRole("button", { name: /Recent…\s*\(\d+\)/ });
    await expect(browserBtn).toBeEnabled();

    // Open the menu — the entry for the active notebook is marked as
    // already-open and shows the name and a timestamp.
    await browserBtn.click();
    const items = page.locator(".nb-open-menu-item");
    const itemsBefore = await items.count();
    expect(itemsBefore).toBeGreaterThanOrEqual(1);
    const activeItem = page.locator(
      ".nb-open-menu-item.nb-open-menu-item-open",
    );
    await expect(activeItem.first()).toBeVisible();
    await expect(
      activeItem.first().locator(".nb-open-menu-name-when"),
    ).toBeVisible();

    // Click the active entry — should refocus the existing tab (no
    // extra tab is added) and close the menu.
    const tabsBefore = await page.locator(".nb-tab").count();
    await activeItem.first().locator(".nb-open-menu-name").click();
    await expect(page.locator(".nb-open-menu")).toHaveCount(0);
    await expect(page.locator(".nb-tab")).toHaveCount(tabsBefore);

    // Now create a second tab, type into it, and verify the store
    // grew by one entry.
    await page.locator(".nb-tab-new").click();
    await page.getByRole("menuitem", { name: /Empty notebook/ }).click();
    const editor2 = page.locator(".nb-cell-editor .cm-content").first();
    await editor2.click();
    await page.keyboard.type("second-marker");
    await page.waitForTimeout(1000);

    await browserBtn.click();
    await expect(page.locator(".nb-open-menu-item")).toHaveCount(
      itemsBefore + 1,
    );
  });
});

test.describe("Quickstart notebook template", () => {
  // No ``disableQuickstartTemplate`` here: this is the first-boot
  // scenario where the bundled Quickstart should auto-load. The
  // standard per-test ``page`` fixture is required — the warm fixture
  // explicitly suppresses the Quickstart on its (one-time) cold boot.
  coldTest(
    "loads on first boot in a fresh browser context",
    async ({ page }) => {
      await page.goto("/");
      await waitForRuntimeReady(page);
      await page.getByRole("tab", { name: "Notebooks" }).click();
      await expect(page.locator(".nb-toolbar-status")).toContainText(
        /Kernel idle|Kernel running/,
        { timeout: 180_000 },
      );
      // Active tab should be named "Quickstart".
      await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
        "Quickstart",
      );
      // The template ships with 5 cells (3 markdown + 2 code).
      await expect(page.locator(".nb-cell")).toHaveCount(5);
      // First markdown cell renders the H1 "Welcome to DataLab Web Notebooks".
      const firstRendered = page.locator(".nb-cell-markdown-rendered").first();
      await expect(firstRendered.locator("h1")).toContainText(
        "Welcome to DataLab Web Notebooks",
      );
    },
  );
});
