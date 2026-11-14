import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecipeInputResolverDialog } from "../../../src/components/RecipeInputResolverDialog";
import type {
  PluginRecipePreparation,
  PluginRecipeReadiness,
} from "../../../src/runtime/runtime";

const PREPARATION: PluginRecipePreparation = {
  plugin_id: "org.example.application",
  recipe_id: "org.example.application:compare",
  title: "Compare signals",
  description: "",
  slots: [
    {
      id: "reference",
      title: "Reference signal",
      description: "Signal acquired without the device under test.",
      object_type: "signal",
      cardinality: "one",
      required: true,
      min_count: 1,
      metadata: [
        {
          key: "channel",
          description: "Acquisition channel",
          required: true,
        },
      ],
    },
  ],
  candidates: [
    {
      id: "signal-a",
      kind: "signal",
      title: "Signal A",
      compatible_slots: ["reference"],
      missing_metadata: { reference: ["channel"] },
    },
    {
      id: "signal-b",
      kind: "signal",
      title: "Signal B",
      compatible_slots: ["reference"],
      missing_metadata: { reference: [] },
    },
  ],
  bindings: { reference: [] },
  ambiguous_slots: ["reference"],
  missing_slots: [],
  readiness: {
    status: "needs_assignment",
    bindings: { reference: [] },
    issues: [{ code: "ambiguous", slot_id: "reference", details: {} }],
    diagnostics: [],
  },
  parameters: null,
};

const OPTIONAL_BINDINGS = { reference: ["signal-b"], targets: [] };
const OPTIONAL_PREPARATION: PluginRecipePreparation = {
  ...PREPARATION,
  slots: [
    ...PREPARATION.slots,
    {
      id: "targets",
      title: "Signals to compare",
      description: "",
      object_type: "signal",
      cardinality: "many",
      required: false,
      min_count: 1,
      metadata: [],
    },
  ],
  candidates: PREPARATION.candidates.map((candidate) => ({
    ...candidate,
    compatible_slots: [...candidate.compatible_slots, "targets"],
  })),
  bindings: OPTIONAL_BINDINGS,
  ambiguous_slots: ["targets"],
  readiness: {
    status: "needs_assignment",
    bindings: OPTIONAL_BINDINGS,
    issues: [{ code: "ambiguous", slot_id: "targets", details: {} }],
    diagnostics: [],
  },
};

function readiness(
  status: PluginRecipeReadiness["status"],
  extra: Partial<PluginRecipeReadiness> = {},
): PluginRecipeReadiness {
  return {
    status,
    bindings: { reference: ["signal-b"] },
    issues: [],
    diagnostics: [],
    ...extra,
  };
}

describe("RecipeInputResolverDialog", () => {
  it("describes what each slot expects and flags missing metadata", () => {
    render(
      <RecipeInputResolverDialog
        preparation={PREPARATION}
        onCheck={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("Inputs of 'Compare signals'")).toBeInTheDocument();
    expect(screen.getByText("Reference signal")).toBeInTheDocument();
    expect(screen.getByText("One signal")).toBeInTheDocument();
    expect(
      screen.getByText("Signal acquired without the device under test."),
    ).toBeInTheDocument();
    expect(screen.getByText("channel")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Signal A (missing: channel)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Signal B" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reference signal: choose the objects to use"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("lets the user confirm valid proposed bindings with empty optional inputs", async () => {
    const onCheck = vi
      .fn()
      .mockResolvedValue(readiness("ready", { bindings: OPTIONAL_BINDINGS }));
    const onSubmit = vi.fn();
    render(
      <RecipeInputResolverDialog
        preparation={OPTIONAL_PREPARATION}
        onCheck={onCheck}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await waitFor(() => {
      expect(onCheck).toHaveBeenCalledWith(OPTIONAL_BINDINGS);
      expect(continueButton).toBeEnabled();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(continueButton);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(OPTIONAL_BINDINGS);
    });
  });

  it("keeps proposed optional inputs blocked when the recipe rejects them", async () => {
    const onCheck = vi.fn().mockResolvedValue(
      readiness("not_ready", {
        bindings: OPTIONAL_BINDINGS,
        diagnostics: [
          {
            level: "error",
            code: "invalid_reference",
            message: "The reference cannot be used",
            details: {},
          },
        ],
      }),
    );
    render(
      <RecipeInputResolverDialog
        preparation={OPTIONAL_PREPARATION}
        onCheck={onCheck}
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );

    expect(
      await screen.findByText("Error: The reference cannot be used"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("ignores an initial check that finishes after the inputs were edited", async () => {
    let resolveInitial!: (value: PluginRecipeReadiness) => void;
    const initialCheck = new Promise<PluginRecipeReadiness>((resolve) => {
      resolveInitial = resolve;
    });
    const onCheck = vi
      .fn()
      .mockReturnValueOnce(initialCheck)
      .mockResolvedValueOnce(
        readiness("not_ready", {
          bindings: { reference: ["signal-b"], targets: ["signal-a"] },
          diagnostics: [
            {
              level: "error",
              code: "invalid_target",
              message: "The target cannot be used",
              details: {},
            },
          ],
        }),
      );
    render(
      <RecipeInputResolverDialog
        preparation={OPTIONAL_PREPARATION}
        onCheck={onCheck}
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );

    await waitFor(() => expect(onCheck).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("checkbox", { name: "Signal A" }));
    expect(
      await screen.findByText("Error: The target cannot be used"),
    ).toBeInTheDocument();
    await act(async () => {
      resolveInitial(readiness("ready", { bindings: OPTIONAL_BINDINGS }));
      await initialCheck;
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("still requires a choice for ambiguous required inputs", () => {
    vi.useFakeTimers();
    try {
      const onCheck = vi.fn();
      const preparation: PluginRecipePreparation = {
        ...OPTIONAL_PREPARATION,
        readiness: {
          ...OPTIONAL_PREPARATION.readiness,
          bindings: { reference: [], targets: [] },
          issues: [
            { code: "ambiguous", slot_id: "reference", details: {} },
            { code: "ambiguous", slot_id: "targets", details: {} },
          ],
        },
      };
      render(
        <RecipeInputResolverDialog
          preparation={preparation}
          onCheck={onCheck}
          onSubmit={vi.fn()}
          onCancel={() => {}}
        />,
      );

      act(() => vi.advanceTimersByTime(250));
      expect(onCheck).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks edited bindings before allowing submission", async () => {
    const onCheck = vi.fn().mockResolvedValue(readiness("ready"));
    const onSubmit = vi.fn();
    render(
      <RecipeInputResolverDialog
        preparation={PREPARATION}
        onCheck={onCheck}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const continueButton = screen.getByRole("button", { name: "Continue" });
    fireEvent.change(screen.getByLabelText("Reference signal"), {
      target: { value: "signal-b" },
    });
    expect(continueButton).toBeDisabled();

    await waitFor(() => {
      expect(onCheck).toHaveBeenCalledWith({ reference: ["signal-b"] });
      expect(continueButton).toBeEnabled();
    });
    expect(
      screen.getByText("Ready to run on the current selection"),
    ).toBeInTheDocument();
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ reference: ["signal-b"] });
    });
  });

  it("keeps submission blocked while the recipe rejects the inputs", async () => {
    const onCheck = vi.fn().mockResolvedValue(
      readiness("not_ready", {
        bindings: { reference: ["signal-a"] },
        issues: [
          {
            code: "missing_metadata",
            slot_id: "reference",
            details: { key: "channel", count: 1, titles: ["Signal A"] },
          },
        ],
        diagnostics: [
          {
            level: "error",
            code: "mixed_units",
            message: "Signals use different X units",
            details: {},
          },
        ],
      }),
    );
    render(
      <RecipeInputResolverDialog
        preparation={PREPARATION}
        onCheck={onCheck}
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Reference signal"), {
      target: { value: "signal-a" },
    });

    expect(
      await screen.findByText(
        "Reference signal: metadata 'channel' missing on 1 object(s) (Signal A)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Error: Signals use different X units"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("lets the user continue despite warnings", async () => {
    const onCheck = vi.fn().mockResolvedValue(
      readiness("warnings", {
        diagnostics: [
          {
            level: "warning",
            code: "short_record",
            message: "The record is short",
            details: {},
          },
        ],
      }),
    );
    render(
      <RecipeInputResolverDialog
        preparation={PREPARATION}
        onCheck={onCheck}
        onSubmit={vi.fn()}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Reference signal"), {
      target: { value: "signal-b" },
    });

    expect(
      await screen.findByText("Warning: The record is short"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});
