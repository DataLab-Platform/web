/**
 * "New workspace" transition used by the showcase between two demos: the
 * workspace must end up untitled (window title, default save name) and
 * unmodified, without any view asking Python for the deleted objects.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useWorkspace,
  WorkspaceProvider,
  type WorkspaceContextValue,
} from "../../../src/runtime/WorkspaceContext";
import { useDocumentTitle } from "../../../src/runtime/useDocumentTitle";
import {
  useWorkspaceReset,
  type WorkspaceResetHandlers,
} from "../../../src/runtime/useWorkspaceReset";
import type { RuntimeApi } from "../../../src/runtime/runtime";

function setup(runtime: RuntimeApi, handlers: WorkspaceResetHandlers) {
  const ref: {
    workspace: WorkspaceContextValue | null;
    reset: (() => Promise<void>) | null;
  } = { workspace: null, reset: null };
  function Probe() {
    const workspace = useWorkspace();
    useDocumentTitle({
      filename: workspace.filename,
      dirty: workspace.dirty,
      recovered: workspace.recovered,
    });
    ref.workspace = workspace;
    ref.reset = useWorkspaceReset(runtime, handlers);
    return null;
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  return ref;
}

describe("useWorkspaceReset", () => {
  it("leaves an untitled, unmodified workspace", async () => {
    const calls: string[] = [];
    const holder: { probe?: ReturnType<typeof setup> } = {};
    const runtime = {
      // Like the runtime, ``reset_all`` notifies a workspace mutation
      // (which marks the workspace modified) before it returns.
      resetAll: vi.fn(async () => {
        calls.push("resetAll");
        holder.probe?.workspace?.markDirty();
      }),
    } as unknown as RuntimeApi;
    const handlers: WorkspaceResetHandlers = {
      clearSelection: vi.fn(() => calls.push("clearSelection")),
      remountPanels: vi.fn(() => calls.push("remountPanels")),
      refresh: vi.fn(async () => {
        calls.push("refresh");
      }),
    };
    const probe = setup(runtime, handlers);
    holder.probe = probe;
    // A workspace opened from a file (e.g. ndt.h5), then modified.
    act(() => {
      probe.workspace!.setFilename("ndt.h5");
      probe.workspace!.markDirty();
    });
    expect(document.title).toBe("DataLab-Web — ndt.h5 •");

    await act(async () => {
      await probe.reset!();
    });

    expect(probe.workspace!.filename).toBeNull();
    expect(probe.workspace!.dirty).toBe(false);
    expect(document.title).toBe("DataLab-Web — Untitled");
    // The selection is dropped before the objects are deleted, and the
    // tree is re-read once the panels are mounted afresh.
    expect(calls).toEqual([
      "clearSelection",
      "resetAll",
      "remountPanels",
      "refresh",
    ]);
  });

  it("does nothing without a runtime", async () => {
    const handlers: WorkspaceResetHandlers = {
      clearSelection: vi.fn(),
      remountPanels: vi.fn(),
      refresh: vi.fn(async () => undefined),
    };
    const probe = setup(null as unknown as RuntimeApi, handlers);
    await act(async () => {
      await probe.reset!();
    });
    expect(handlers.clearSelection).not.toHaveBeenCalled();
  });
});
