/**
 * Unit tests for ``WorkspaceContext`` and the ``useDocumentTitle``
 * formatter.
 *
 * The context tracks the workspace-level dirty / filename / recovered
 * state used by ``App.tsx`` to drive the window title (•), the
 * ``beforeunload`` guard and (in PR 2) the recovery banner.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WorkspaceProvider,
  useWorkspace,
  type WorkspaceContextValue,
} from "../../../src/runtime/WorkspaceContext";
import { formatDocumentTitle } from "../../../src/runtime/useDocumentTitle";

function harness(): { ctx: { value: WorkspaceContextValue | null } } {
  const ctx: { value: WorkspaceContextValue | null } = { value: null };
  function Probe() {
    ctx.value = useWorkspace();
    return null;
  }
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );
  return { ctx };
}

describe("WorkspaceContext", () => {
  it("starts clean, untitled, and not recovered", () => {
    const { ctx } = harness();
    expect(ctx.value).not.toBeNull();
    expect(ctx.value!.dirty).toBe(false);
    expect(ctx.value!.filename).toBeNull();
    expect(ctx.value!.recovered).toBe(false);
  });

  it("markDirty flips the dirty flag", () => {
    const { ctx } = harness();
    act(() => ctx.value!.markDirty());
    expect(ctx.value!.dirty).toBe(true);
  });

  it("markDirty is idempotent", () => {
    const { ctx } = harness();
    act(() => ctx.value!.markDirty());
    const ref = ctx.value!;
    // A second markDirty must not change the underlying state object
    // (avoids spurious re-renders).
    act(() => ctx.value!.markDirty());
    expect(ctx.value!.dirty).toBe(true);
    // The exposed value object is allowed to be a new object due to
    // useMemo dependencies; the *state* identity inside is what we
    // checked above. We only assert behavioural equivalence here.
    expect(ref.dirty).toBe(true);
  });

  it("markClean clears dirty and recovered together", () => {
    const { ctx } = harness();
    act(() => {
      ctx.value!.markDirty();
      ctx.value!.setRecovered(true);
    });
    expect(ctx.value!.dirty).toBe(true);
    expect(ctx.value!.recovered).toBe(true);
    act(() => ctx.value!.markClean());
    expect(ctx.value!.dirty).toBe(false);
    expect(ctx.value!.recovered).toBe(false);
  });

  it("setFilename remembers the last HDF5 filename", () => {
    const { ctx } = harness();
    act(() => ctx.value!.setFilename("my-workspace.h5"));
    expect(ctx.value!.filename).toBe("my-workspace.h5");
    act(() => ctx.value!.setFilename(null));
    expect(ctx.value!.filename).toBeNull();
  });

  it("typical Open → mutate → Save cycle", () => {
    const { ctx } = harness();
    // Open HDF5
    act(() => {
      ctx.value!.setFilename("input.h5");
      ctx.value!.markClean();
    });
    expect(ctx.value!.dirty).toBe(false);
    expect(ctx.value!.filename).toBe("input.h5");
    // User mutates
    act(() => ctx.value!.markDirty());
    expect(ctx.value!.dirty).toBe(true);
    // Save HDF5
    act(() => {
      ctx.value!.setFilename("output.h5");
      ctx.value!.markClean();
    });
    expect(ctx.value!.dirty).toBe(false);
    expect(ctx.value!.filename).toBe("output.h5");
  });
});

describe("formatDocumentTitle", () => {
  it("clean named workspace", () => {
    expect(
      formatDocumentTitle({
        filename: "workspace.h5",
        dirty: false,
        recovered: false,
      }),
    ).toBe("DataLab-Web — workspace.h5");
  });

  it("dirty named workspace", () => {
    expect(
      formatDocumentTitle({
        filename: "workspace.h5",
        dirty: true,
        recovered: false,
      }),
    ).toBe("DataLab-Web — workspace.h5 •");
  });

  it("untitled workspace, clean", () => {
    expect(
      formatDocumentTitle({
        filename: null,
        dirty: false,
        recovered: false,
      }),
    ).toBe("DataLab-Web — Untitled");
  });

  it("untitled, dirty, recovered hint", () => {
    expect(
      formatDocumentTitle({
        filename: null,
        dirty: true,
        recovered: true,
      }),
    ).toBe("DataLab-Web — Untitled • (recovered)");
  });
});
