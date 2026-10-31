import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// The macro worker plays no part in restoring or importing macros.
vi.mock("../../../src/runtime/MacroRuntime", () => ({
  MacroRuntime: class {
    externalCallbacks = {};
    preload(): Promise<void> {
      return Promise.resolve();
    }
    dispose(): void {}
  },
}));

import {
  MacroPanel,
  type MacroPanelHandle,
} from "../../../src/components/MacroPanel";
import { DialogProvider } from "../../../src/components/ConfirmDialog";
import { ToastProvider } from "../../../src/components/Toast";
import type { MacroRecord, RuntimeApi } from "../../../src/runtime/runtime";
import { PendingHandle } from "../../../src/utils/pendingHandle";

/**
 * Runtime holding the macros of the workspace, whose ``listMacros`` answers
 * only once released. Like the runtime worker, which handles calls in
 * order, it lists the macros as they are when it is called.
 */
function fakeRuntime(): { runtime: RuntimeApi; releaseList: () => void } {
  const macros: MacroRecord[] = [
    { id: "m1", title: "Workspace macro", code: "print(1)" },
  ];
  let releaseList!: () => void;
  const listHeld = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  const runtime = {
    listMacros: vi.fn(async () => {
      const metas = macros.map(({ id, title }) => ({ id, title }));
      await listHeld;
      return metas;
    }),
    getMacro: vi.fn(async (id: string) => macros.find((m) => m.id === id)),
    createMacro: vi.fn(async (title?: string, code?: string) => {
      const rec = {
        id: `m${macros.length + 1}`,
        title: title ?? "Untitled",
        code: code ?? "",
      };
      macros.push(rec);
      return rec;
    }),
    setMacroCode: vi.fn(async () => undefined),
  };
  return { runtime: runtime as unknown as RuntimeApi, releaseList };
}

describe("MacroPanel — importing a macro", () => {
  it("keeps a macro imported while the workspace macros are restored", async () => {
    window.localStorage.clear();
    const { runtime, releaseList } = fakeRuntime();
    const panel = new PendingHandle<MacroPanelHandle>("Macros panel");
    render(
      <ToastProvider>
        <DialogProvider>
          <MacroPanel
            ref={panel.ref}
            runtime={runtime}
            onSetCurrentPanel={() => undefined}
            getSelection={() => []}
            getCurrentPanel={() => "signal"}
            selectObjects={() => undefined}
            onModelChanged={() => undefined}
            theme="light"
          />
        </DialogProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(runtime.listMacros).toHaveBeenCalled());
    // E.g. "Save to Macros" in the AI Assistant right after a reload.
    let importDone = false;
    const imported = panel
      .wait(5000)
      .then((handle) => handle.importMacro("Saved macro", "print(2)"))
      .then(() => {
        importDone = true;
      });
    releaseList();
    // Both done: the import, and the restoration of the workspace macros.
    await waitFor(() => {
      expect(importDone).toBe(true);
      expect(
        screen.getByRole("tab", { name: /Workspace macro/ }),
      ).toBeInTheDocument();
    });
    await imported;
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringContaining("Workspace macro"),
      expect.stringContaining("Saved macro"),
    ]);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "Saved macro",
    );
  });
});
