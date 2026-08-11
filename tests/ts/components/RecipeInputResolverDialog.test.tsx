import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecipeInputResolverDialog } from "../../../src/components/RecipeInputResolverDialog";
import type { PluginRecipePreparation } from "../../../src/runtime/runtime";

const PREPARATION: PluginRecipePreparation = {
  plugin_id: "org.example.application",
  recipe_id: "org.example.application:compare",
  title: "Compare signals",
  description: "",
  slots: [
    {
      id: "reference",
      object_type: "signal",
      cardinality: "one",
      required: true,
    },
  ],
  candidates: [
    {
      id: "signal-a",
      kind: "signal",
      title: "Signal A",
      compatible_slots: ["reference"],
    },
    {
      id: "signal-b",
      kind: "signal",
      title: "Signal B",
      compatible_slots: ["reference"],
    },
  ],
  bindings: { reference: [] },
  ambiguous_slots: ["reference"],
  missing_slots: ["reference"],
  parameters: null,
};

describe("RecipeInputResolverDialog", () => {
  it("requires and submits one compatible object for a ONE slot", async () => {
    const onSubmit = vi.fn();
    render(
      <RecipeInputResolverDialog
        preparation={PREPARATION}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("reference"), {
      target: { value: "signal-b" },
    });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ reference: ["signal-b"] });
      expect(continueButton).toBeEnabled();
    });
  });
});
