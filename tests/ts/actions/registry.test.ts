import { describe, it, expect, vi } from "vitest";
import {
  buildStaticActions,
  buildHelpActions,
  buildFeatureActions,
  buildInteractiveFitActions,
  buildSignalCreationActions,
  buildImageCreationActions,
  buildViewActions,
} from "../../../src/actions/registry";
import type { ActionState } from "../../../src/actions/types";

function makeState(over: Partial<ActionState> = {}): ActionState {
  return {
    status: "ready",
    busy: false,
    selectedIds: [],
    currentId: null,
    hasObjects: false,
    ...over,
  };
}

function makeStaticCallbacks() {
  return {
    onNewGroup: vi.fn(),
    onDeleteSelection: vi.fn(),
    onEditProperties: vi.fn(),
    onOpenFile: vi.fn(),
    onSaveFile: vi.fn(),
    onSaveToDirectory: vi.fn(),
    onOpenWorkspaceHdf5: vi.fn(),
    onSaveWorkspaceHdf5: vi.fn(),
    onImportHdf5: vi.fn(),
    onImportTextWizard: vi.fn(),
    panel: "signal" as const,
  };
}

describe("buildStaticActions", () => {
  it("uses the current panel kind in the File menu wording", () => {
    const sigActions = buildStaticActions(makeStaticCallbacks());
    const open = sigActions.find((a) => a.id === "file.open");
    expect(open?.label).toBe("Open signal…");

    const imgActions = buildStaticActions({
      ...makeStaticCallbacks(),
      panel: "image",
    });
    expect(imgActions.find((a) => a.id === "file.open")?.label).toBe(
      "Open image…",
    );
  });

  it("disables ``file.save`` until an object is selected", () => {
    const actions = buildStaticActions(makeStaticCallbacks());
    const save = actions.find((a) => a.id === "file.save")!;
    expect(save.enabled(makeState())).toBe(false);
    expect(save.enabled(makeState({ currentId: "abc" }))).toBe(true);
  });

  it("disables ``edit.delete`` when nothing is selected", () => {
    const actions = buildStaticActions(makeStaticCallbacks());
    const del = actions.find((a) => a.id === "edit.delete")!;
    expect(del.enabled(makeState())).toBe(false);
    expect(del.enabled(makeState({ selectedIds: ["x"] }))).toBe(true);
  });

  it("delegates ``edit.new_group`` to the supplied callback", () => {
    const cb = makeStaticCallbacks();
    const actions = buildStaticActions(cb);
    actions.find((a) => a.id === "edit.new_group")!.run();
    expect(cb.onNewGroup).toHaveBeenCalledOnce();
  });

  it("disables every action when the runtime is busy", () => {
    const actions = buildStaticActions(makeStaticCallbacks());
    const busy = makeState({ busy: true, currentId: "x" });
    expect(actions.find((a) => a.id === "file.open")!.enabled(busy)).toBe(
      false,
    );
    expect(actions.find((a) => a.id === "edit.new_group")!.enabled(busy)).toBe(
      false,
    );
  });
});

describe("buildHelpActions", () => {
  it("provides four entries always enabled", () => {
    const actions = buildHelpActions({
      onShowAbout: vi.fn(),
      onShowShortcuts: vi.fn(),
      onShowConsole: vi.fn(),
    });
    expect(actions).toHaveLength(4);
    for (const a of actions) {
      expect(a.enabled(makeState({ status: "loading" }))).toBe(true);
    }
  });
});

describe("buildFeatureActions", () => {
  it("maps Sigima feature descriptors to action descriptors", () => {
    const onApply = vi.fn();
    const actions = buildFeatureActions(
      [
        {
          id: "normalize",
          label: "Normalize",
          menu_path: "Processing/Normalize",
          pattern: "1_to_1",
          icon: null,
          has_params: false,
          operand_label: "",
          object_kind: "signal",
          output_kind: "signal",
        },
      ],
      onApply,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("feature.normalize");
    expect(actions[0].menuPath).toBe("Processing/Normalize");
    actions[0].run();
    expect(onApply).toHaveBeenCalledWith("normalize");
  });

  it("requires a selection or current object for 1-to-1 features", () => {
    const [act] = buildFeatureActions(
      [
        {
          id: "x",
          label: "X",
          menu_path: "M/X",
          pattern: "1_to_1",
          icon: null,
          has_params: false,
          operand_label: "",
          object_kind: "signal",
          output_kind: "signal",
        },
      ],
      vi.fn(),
    );
    expect(act.enabled(makeState())).toBe(false);
    expect(act.enabled(makeState({ currentId: "abc" }))).toBe(true);
  });
});

describe("buildInteractiveFitActions", () => {
  it("creates a separator before the first item only", () => {
    const actions = buildInteractiveFitActions(
      [
        { id: "linear", label: "Linear", needs_degree: false },
        { id: "poly", label: "Polynomial", needs_degree: true },
      ],
      vi.fn(),
    );
    expect(actions[0].beginGroup).toBe(true);
    expect(actions[1].beginGroup).toBe(false);
  });
});

describe("buildSignalCreationActions / buildImageCreationActions", () => {
  it("preserves the catalogue order and separator flags", () => {
    const sigActions = buildSignalCreationActions(
      [
        {
          value: "gauss",
          label: "Gaussian",
          icon: "g.svg",
          separator_before: false,
        },
        { value: "sine", label: "Sine", icon: "s.svg", separator_before: true },
      ],
      vi.fn(),
    );
    expect(sigActions.map((a) => a.id)).toEqual([
      "create.signal.gauss",
      "create.signal.sine",
    ]);
    expect(sigActions[1].beginGroup).toBe(true);
  });

  it("calls onCreate with the type value", () => {
    const onCreate = vi.fn();
    const [act] = buildImageCreationActions(
      [
        {
          value: "ramp",
          label: "Ramp",
          icon: "r.svg",
          separator_before: false,
        },
      ],
      onCreate,
    );
    act.run();
    expect(onCreate).toHaveBeenCalledWith("ramp");
  });
});

describe("buildViewActions", () => {
  function makeViewCallbacks(
    over: Partial<Parameters<typeof buildViewActions>[0]> = {},
  ) {
    return {
      showResultsOverlay: false,
      onToggleResultsOverlay: vi.fn(),
      showGraphicalTitles: true,
      onToggleGraphicalTitles: vi.fn(),
      onOpenSeparateView: vi.fn(),
      hasSelection: true,
      ...over,
    };
  }

  it("exposes one popout entry and two checkable toggles", () => {
    const actions = buildViewActions(makeViewCallbacks());
    expect(actions.map((a) => a.id)).toEqual([
      "view.open_separate_view",
      "view.results_overlay",
      "view.show_graphical_titles",
    ]);
  });

  it("prefixes the active toggle with a checkmark glyph", () => {
    const offActions = buildViewActions(
      makeViewCallbacks({
        showResultsOverlay: false,
        showGraphicalTitles: false,
      }),
    );
    const onActions = buildViewActions(
      makeViewCallbacks({
        showResultsOverlay: true,
        showGraphicalTitles: true,
      }),
    );
    expect(
      offActions.find((a) => a.id === "view.results_overlay")!.label,
    ).not.toMatch(/^\u2713/);
    expect(
      onActions.find((a) => a.id === "view.results_overlay")!.label,
    ).toMatch(/^\u2713 /);
    expect(
      onActions.find((a) => a.id === "view.show_graphical_titles")!.label,
    ).toMatch(/^\u2713 /);
  });

  it("disables the popout when nothing is selected", () => {
    const actions = buildViewActions(
      makeViewCallbacks({ hasSelection: false }),
    );
    const popout = actions.find((a) => a.id === "view.open_separate_view")!;
    expect(popout.enabled(makeState({ currentId: null }))).toBe(false);
    expect(
      popout.enabled(makeState({ currentId: "x", selectedIds: ["x"] })),
    ).toBe(false);
  });

  it("disables the popout when the runtime is busy", () => {
    const actions = buildViewActions(makeViewCallbacks());
    const popout = actions.find((a) => a.id === "view.open_separate_view")!;
    expect(
      popout.enabled(
        makeState({ busy: true, currentId: "x", selectedIds: ["x"] }),
      ),
    ).toBe(false);
  });

  it("enables the popout when there is a current object and a selection", () => {
    const actions = buildViewActions(makeViewCallbacks({ hasSelection: true }));
    const popout = actions.find((a) => a.id === "view.open_separate_view")!;
    expect(
      popout.enabled(makeState({ currentId: "x", selectedIds: ["x"] })),
    ).toBe(true);
  });

  it("toggles trigger their callbacks", () => {
    const cb = makeViewCallbacks();
    const actions = buildViewActions(cb);
    actions.find((a) => a.id === "view.results_overlay")!.run();
    actions.find((a) => a.id === "view.show_graphical_titles")!.run();
    actions.find((a) => a.id === "view.open_separate_view")!.run();
    expect(cb.onToggleResultsOverlay).toHaveBeenCalledOnce();
    expect(cb.onToggleGraphicalTitles).toHaveBeenCalledOnce();
    expect(cb.onOpenSeparateView).toHaveBeenCalledOnce();
  });
});
