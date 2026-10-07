import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
