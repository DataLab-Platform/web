import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { ReactElement, Ref } from "react";

// The macro worker plays no part in restoring or importing macros.
vi.mock("../../../src/runtime/MacroRuntime", () => {
  class MacroRuntime {
    externalCallbacks = {};
    preload(): Promise<void> {
      return Promise.resolve();
    }
    dispose(): void {}
  }
  const shared = new MacroRuntime();
  return { MacroRuntime, panelMacroRuntime: () => shared };
});

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
    await act(async () => {
      await Promise.resolve();
    });
    expect(runtime.createMacro).not.toHaveBeenCalled();
    expect(importDone).toBe(false);
    await act(async () => {
      releaseList();
    });
    await act(async () => {
      await imported;
    });
    // Both done: the import, and the restoration of the workspace macros.
    await waitFor(() => {
      expect(importDone).toBe(true);
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
});

/**
 * Runtime holding a macro store like ``bootstrap.py``: new macros are
 * named "Untitled N" with the first number not used by the store.
 */
function storeRuntime(): RuntimeApi {
  const macros: MacroRecord[] = [];
  let next = 0;
  const untitled = () => {
    const used = new Set(macros.map((m) => m.title));
    let n = 1;
    while (used.has(`Untitled ${n}`)) n += 1;
    return `Untitled ${n}`;
  };
  return {
    listMacros: vi.fn(async () =>
      macros.map(({ id, title }) => ({ id, title })),
    ),
    getMacro: vi.fn(async (id: string) => macros.find((m) => m.id === id)),
    createMacro: vi.fn(async (title?: string, code?: string) => {
      next += 1;
      const rec = {
        id: `m${next}`,
        title: title || untitled(),
        code: code ?? "",
      };
      macros.push(rec);
      return rec;
    }),
    setMacroCode: vi.fn(async () => undefined),
  } as unknown as RuntimeApi;
}

function macroPanel(
  runtime: RuntimeApi,
  ref?: Ref<MacroPanelHandle>,
): ReactElement {
  return (
    <ToastProvider>
      <DialogProvider>
        <MacroPanel
          ref={ref}
          runtime={runtime}
          onSetCurrentPanel={() => undefined}
          getSelection={() => []}
          getCurrentPanel={() => "signal"}
          selectObjects={() => undefined}
          onModelChanged={() => undefined}
          theme="light"
        />
      </DialogProvider>
    </ToastProvider>
  );
}

describe("MacroPanel — Recent… counter", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const { _resetForTests } = await import("../../../src/storage/recentStore");
    _resetForTests();
  });

  it("follows entries recorded or removed elsewhere", async () => {
    const { recordRecent, removeRecent } =
      await import("../../../src/storage/recentStore");
    render(macroPanel(storeRuntime()));
    const recent = await screen.findByRole("button", { name: /^Recent… \(/ });
    await waitFor(() => expect(recent).toHaveTextContent("Recent… (0)"));
    await act(async () => {
      await recordRecent("macro", { id: "x", title: "X", content: "" });
    });
    await waitFor(() => expect(recent).toHaveTextContent("Recent… (1)"));
    await act(async () => {
      await removeRecent("macro", "x");
    });
    await waitFor(() => expect(recent).toHaveTextContent("Recent… (0)"));
  });

  it("stays exact when a new macro evicts the oldest entry", async () => {
    const { recordRecent, setMaxEntries } =
      await import("../../../src/storage/recentStore");
    setMaxEntries("macro", 2);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    await recordRecent("macro", { id: "old1", title: "Old 1", content: "" });
    await tick();
    await recordRecent("macro", { id: "old2", title: "Old 2", content: "" });
    await tick();
    const panel = new PendingHandle<MacroPanelHandle>("Macros panel");
    render(macroPanel(storeRuntime(), panel.ref));
    const recent = await screen.findByRole("button", { name: /^Recent… \(/ });
    await waitFor(() => expect(recent).toHaveTextContent("Recent… (2)"));
    fireEvent.click(recent);
    // Importing a macro records it in the full cache, which drops the
    // oldest entry: the counter and the menu used to keep it.
    const handle = await panel.wait(5000);
    await act(async () => {
      await handle.importMacro("Imported", "print(1)");
    });
    const titles = () =>
      Array.from(
        document.querySelectorAll(".macro-recent-menu-name-text"),
        (item) => item.textContent ?? "",
      );
    await waitFor(() => {
      expect(titles()).toEqual([
        expect.stringMatching(/^Imported/),
        expect.stringMatching(/^Old 2/),
      ]);
      expect(recent).toHaveTextContent("Recent… (2)");
    });
  });
});
