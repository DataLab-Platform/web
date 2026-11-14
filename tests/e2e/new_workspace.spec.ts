import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

import type { DataLabRuntime } from "../../src/runtime/runtime";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

const WORKSPACE = fileURLToPath(
  new URL("../../public/demos/ndt.h5", import.meta.url),
);

async function openNewWorkspace(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();
}

async function replaceEditor(page: Page, selector: string, code: string) {
  await page.locator(selector).first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(code);
}

function recentEntries(
  page: Page,
): Promise<{ kind: string; content: string }[]> {
  return page.evaluate(
    () =>
      new Promise<{ kind: string; content: string }[]>((resolve, reject) => {
        const request = indexedDB.open("datalab-web.recent");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const entries = db
            .transaction("entries")
            .objectStore("entries")
            .getAll();
          entries.onerror = () => {
            db.close();
            reject(entries.error);
          };
          entries.onsuccess = () => {
            const result = entries.result.map(
              ({ kind, content }: { kind: string; content: string }) => ({
                kind,
                content,
              }),
            );
            db.close();
            resolve(result);
          };
        };
      }),
  );
}

async function expectUntitledSaveName(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & {
      suggestedWorkspaceName?: string;
      showSaveFilePicker: (options: {
        suggestedName: string;
      }) => Promise<never>;
    };
    state.suggestedWorkspaceName = undefined;
    state.showSaveFilePicker = async (options) => {
      state.suggestedWorkspaceName = options.suggestedName;
      throw new DOMException("Cancelled", "AbortError");
    };
  });
  await page.getByRole("menuitem", { name: "File" }).first().click();
  const save = page.getByRole("menuitem", { name: "Save to HDF5 file…" });
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await save.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { suggestedWorkspaceName?: string })
            .suggestedWorkspaceName,
      ),
    )
    .toBe("Untitled.h5");
}

test("replaces a running workspace without reloading Python", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await disableQuickstartTemplate(page);
  await page.goto("/?runtime=worker");
  await waitForRuntimeReady(page);
  await page.evaluate(async () => {
    (
      window as typeof window & { workspaceSentinel: string }
    ).workspaceSentinel = "same page";
    await window.runtime.setStorageMode("disk");
  });

  await page.getByRole("tab", { name: "Macros" }).click();
  const macroEditor = ".macro-editor .cm-content";
  await expect(page.locator(macroEditor).first()).toBeVisible();
  const defaultMacro = await page.locator(macroEditor).first().innerText();
  await replaceEditor(
    page,
    macroEditor,
    'import asyncio\nprint("macro-active", flush=True)\nawait asyncio.sleep(600)',
  );
  await page.getByRole("button", { name: /^▶ Run/ }).click();
  await expect(
    page
      .locator(".macro-console-line.stdout")
      .filter({ hasText: "macro-active" }),
  ).toBeVisible({ timeout: 240_000 });

  await page.getByRole("tab", { name: "Notebooks" }).click();
  const notebookEditor = ".nb-cell-editor .cm-content";
  await replaceEditor(
    page,
    notebookEditor,
    [
      "import asyncio",
      "import numpy as np",
      "old_namespace_marker = 123",
      'await proxy.add_signal("old signal", np.arange(4), np.arange(4))',
      'print("notebook-active", flush=True)',
      "await asyncio.sleep(600)",
    ].join("\n"),
  );
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".nb-output-stdout")).toContainText(
    "notebook-active",
    { timeout: 240_000 },
  );
  await expect(page.locator(".nb-cell-running")).toHaveCount(1);
  await page.evaluate(() =>
    window.runtime.addImageFromArray({
      title: "old image",
      data: [
        [1, 2],
        [3, 4],
      ],
    }),
  );
  await expect
    .poll(() => page.evaluate(() => window.runtime.getSpilledCount()))
    .toBeGreaterThan(0);
  const cachedEdits = expect.arrayContaining([
    expect.objectContaining({
      kind: "macro",
      content: expect.stringContaining("macro-active"),
    }),
    expect.objectContaining({
      kind: "notebook",
      content: expect.stringContaining("old_namespace_marker"),
    }),
  ]);
  await expect.poll(() => recentEntries(page)).toEqual(cachedEdits);

  const editorWorkers = page
    .workers()
    .filter((worker) => /macroWorker|notebookWorker/.test(worker.url()));
  const kernelWorker = page
    .workers()
    .find((worker) => /kernelWorker/.test(worker.url()));
  expect(kernelWorker).toBeDefined();
  let kernelClosed = false;
  kernelWorker?.once("close", () => {
    kernelClosed = true;
  });
  expect(editorWorkers.some((worker) => /macroWorker/.test(worker.url()))).toBe(
    true,
  );
  expect(
    editorWorkers.some((worker) => /notebookWorker/.test(worker.url())),
  ).toBe(true);
  let closedWorkers = 0;
  for (const worker of editorWorkers) {
    worker.once("close", () => {
      closedWorkers += 1;
    });
  }

  await openNewWorkspace(page);
  const dialog = page.getByRole("dialog").filter({ hasText: "New workspace" });
  await expect(dialog).toContainText("running Python code will be stopped");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "0",
  );
  await expect(page.locator(".nb-cell-running")).toHaveCount(1);
  await expect(page.locator(notebookEditor).first()).toContainText(
    "old_namespace_marker",
  );
  expect(closedWorkers).toBe(0);

  await openNewWorkspace(page);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "1",
    { timeout: 60_000 },
  );
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-state",
    "idle",
  );
  await expect(page).toHaveTitle("DataLab-Web — Untitled");
  await expect(page.locator(".object-tree-item")).toHaveCount(0);
  await expect.poll(() => closedWorkers).toBe(editorWorkers.length);
  expect(kernelClosed).toBe(false);
  const state = await page.evaluate(async () => {
    const signalTree = await window.runtime.getPanelTree("signal");
    const imageTree = await window.runtime.getPanelTree("image");
    return {
      sentinel: (window as typeof window & { workspaceSentinel: string })
        .workspaceSentinel,
      signals: await window.runtime.listSignals(),
      images: await window.runtime.listImages(),
      signalGroups: signalTree.groups.length,
      imageGroups: imageTree.groups.length,
      storageMode: window.runtime.getStorageMode(),
      spilled: window.runtime.getSpilledCount(),
    };
  });
  expect(state).toEqual({
    sentinel: "same page",
    signals: [],
    images: [],
    signalGroups: 1,
    imageGroups: 1,
    storageMode: "disk",
    spilled: 0,
  });
  await expect.poll(() => recentEntries(page)).toEqual(cachedEdits);

  await page.getByRole("tab", { name: "Macros" }).click();
  await expect(page.locator(".macro-tab")).toHaveCount(1);
  await expect
    .poll(() => page.locator(macroEditor).first().innerText())
    .toBe(defaultMacro);
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await expect(page.locator(".nb-tab")).toHaveCount(1);
  await expect(page.locator(notebookEditor).first()).toHaveText("");
  await expect(page.locator(".nb-output-stdout")).toHaveCount(0);
  await replaceEditor(
    page,
    notebookEditor,
    'print("fresh namespace", "old_namespace_marker" in globals())',
  );
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".nb-output-stdout")).toContainText(
    "fresh namespace False",
    { timeout: 240_000 },
  );
  await expect(page.locator(".nb-cell-prompt").first()).toContainText("[1]");
});

test("a running assistant macro requires confirmation and is stopped", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await disableQuickstartTemplate(page);
  await page.goto("/?runtime=worker");
  await waitForRuntimeReady(page);
  await page.evaluate(() => {
    const state = window as typeof window & {
      assistantRun: Promise<{ status: string }>;
      assistantFinished: boolean;
    };
    state.assistantFinished = false;
    state.assistantRun = window.runtime
      .runMacroCode("import asyncio\nawait asyncio.sleep(600)")
      .then((result) => {
        state.assistantFinished = true;
        return result;
      });
  });
  await openNewWorkspace(page);
  const dialog = page.getByRole("dialog").filter({ hasText: "New workspace" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { assistantFinished: boolean })
          .assistantFinished,
    ),
  ).toBe(false);

  await openNewWorkspace(page);
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & {
      lateAssistantRun: Promise<string>;
    };
    state.lateAssistantRun = window.runtime
      .runMacroCode('print("must not run in the next workspace")')
      .then(
        () => "ran",
        (error: Error) => error.message,
      );
  });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "1",
    { timeout: 60_000 },
  );
  const result = await page.evaluate(
    () =>
      (window as typeof window & { assistantRun: Promise<{ status: string }> })
        .assistantRun,
  );
  expect(result.status).toBe("stopped");
  const lateResult = await page.evaluate(
    () =>
      (window as typeof window & { lateAssistantRun: Promise<string> })
        .lateAssistantRun,
  );
  expect(lateResult).toContain("workspace changed");
  const freshRun = await page.evaluate(() =>
    window.runtime.runMacroCode(
      [
        "import numpy as np",
        'await proxy.add_signal("assistant fresh", np.arange(2), np.arange(2))',
        'print("assistant ready")',
      ].join("\n"),
    ),
  );
  expect(freshRun.status).toBe("ok");
  expect(freshRun.stdout).toContain("assistant ready");
  expect(
    (await page.evaluate(() => window.runtime.listSignals())).map(
      (signal) => signal.title,
    ),
  ).toContain("assistant fresh");
});

test("immediate edits are confirmed in main-thread mode", async ({ page }) => {
  test.setTimeout(360_000);
  await disableQuickstartTemplate(page);
  await page.goto("/?runtime=main");
  await waitForRuntimeReady(page);
  await expectUntitledSaveName(page);
  await page.getByRole("tab", { name: "Notebooks" }).click();
  const editor = ".nb-cell-editor .cm-content";
  await replaceEditor(page, editor, 'print("unsaved")');
  await openNewWorkspace(page);
  const dialog = page.getByRole("dialog").filter({ hasText: "New workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "1",
    { timeout: 60_000 },
  );
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await expect(page.locator(editor).first()).toHaveText("");
  await expect(page).toHaveTitle("DataLab-Web — Untitled");
  await expectUntitledSaveName(page);

  await page.evaluate(() => {
    const state = window as typeof window & { restoreReset: () => void };
    const original = window.runtime.resetAll.bind(window.runtime);
    state.restoreReset = () => {
      window.runtime.resetAll = original;
    };
    window.runtime.resetAll = async () => {
      throw new Error("simulated reset failure");
    };
  });
  await openNewWorkspace(page);
  const failure = page.getByRole("dialog").filter({ hasText: "New workspace" });
  await expect(failure).toContainText("simulated reset failure");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-state",
    "error",
  );
  await failure.getByRole("button", { name: "OK" }).click();
  await page.evaluate(() => {
    (window as typeof window & { restoreReset: () => void }).restoreReset();
  });
  await openNewWorkspace(page);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "2",
    { timeout: 60_000 },
  );

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: "Open HDF5 files…" }).click();
  await (await chooser).setFiles(WORKSPACE);
  await expect(page).toHaveTitle("DataLab-Web — ndt.h5", { timeout: 60_000 });
  await openNewWorkspace(page);
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "3",
    { timeout: 60_000 },
  );
  await expect(page).toHaveTitle("DataLab-Web — Untitled");
  await expectUntitledSaveName(page);
});

test("confirms changes made by an accepted remote call", async ({ page }) => {
  test.setTimeout(360_000);
  await disableQuickstartTemplate(page);
  await page.goto("/?runtime=main&allowedOrigins=*");
  await waitForRuntimeReady(page);
  await expect(page.locator(".macro-tab")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator(".nb-tab")).toHaveCount(1, { timeout: 60_000 });
  await expect(page).toHaveTitle("DataLab-Web — Untitled");

  await page.evaluate(() => {
    const state = window as typeof window & {
      remoteStarted: boolean;
      releaseRemote: () => void;
    };
    const original = window.runtime.createGroup.bind(window.runtime);
    const held = new Promise<void>((resolve) => {
      state.releaseRemote = resolve;
    });
    state.remoteStarted = false;
    window.runtime.createGroup = async (kind, name) => {
      state.remoteStarted = true;
      await held;
      return original(kind, name);
    };
    window.postMessage(
      {
        id: "new-workspace-remote",
        type: "request",
        method: "add_group",
        params: { title: "remote group", panel: "signal" },
      },
      location.origin,
    );
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { remoteStarted: boolean }).remoteStarted,
      ),
    )
    .toBe(true);
  await openNewWorkspace(page);
  await page.evaluate(() => {
    (window as typeof window & { releaseRemote: () => void }).releaseRemote();
  });
  const dialog = page.getByRole("dialog").filter({ hasText: "New workspace" });
  await expect(dialog).toBeVisible();
  const lateError = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error("Late remote call did not receive a reply")),
          10_000,
        );
        const onMessage = (event: MessageEvent) => {
          if (
            event.data?.type !== "response" ||
            event.data.id !== "late-remote"
          ) {
            return;
          }
          clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          resolve(event.data.error?.message ?? "");
        };
        window.addEventListener("message", onMessage);
        window.postMessage(
          {
            id: "late-remote",
            type: "request",
            method: "add_group",
            params: { title: "too late", panel: "signal" },
          },
          location.origin,
        );
      }),
  );
  expect(lateError).toContain("workspace is being reset");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const names = await page.evaluate(async () =>
    (await window.runtime.getPanelTree("signal")).groups.map(
      (group) => group.name,
    ),
  );
  expect(names).toContain("remote group");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-workspace-reset-id",
    "0",
  );
});
