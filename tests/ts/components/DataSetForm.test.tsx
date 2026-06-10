/**
 * Tests for :class:`DataSetForm` display-callback support.
 *
 * Mirrors ``ArithmeticParam``: editing a field that carries
 * ``x-guidata-has-callback`` round-trips through the ``resolveCallbacks``
 * resolver (the browser equivalent of guidata's Qt ``update_widgets``
 * cascade) and refreshes the read-only computed preview, which is itself
 * rendered disabled because of ``x-guidata-active: false``.
 */

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DataSetForm } from "../../../src/components/DataSetForm";
import type { JsonSchema } from "../../../src/runtime/runtime";

// A minimal Arithmetic-like schema: an editable ``factor`` with a display
// callback, plus a read-only ``operation`` preview (``active: false``).
const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    factor: {
      type: "number",
      "x-guidata-kind": "float",
      "x-guidata-label": "Factor",
      "x-guidata-name": "factor",
      "x-guidata-has-callback": true,
    },
    operation: {
      type: "string",
      "x-guidata-kind": "string",
      "x-guidata-label": "Operation",
      "x-guidata-name": "operation",
      "x-guidata-active": false,
    },
  },
  "x-guidata-property-order": ["factor", "operation"],
};

function ControlledForm(props: {
  resolveCallbacks?: (
    itemName: string,
    values: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  initial?: Record<string, unknown>;
}) {
  // DataSetForm is controlled; mirror DataSetDialog's local state.
  const [values, setValues] = useState<Record<string, unknown>>(
    props.initial ?? { factor: 1, operation: "" },
  );
  return (
    <DataSetForm
      schema={SCHEMA}
      values={values}
      onChange={setValues}
      resolveCallbacks={props.resolveCallbacks}
    />
  );
}

describe("DataSetForm display callbacks", () => {
  it("renders an active:false field as disabled", () => {
    render(
      <ControlledForm initial={{ factor: 1, operation: "obj3 = obj1" }} />,
    );
    const operation = screen.getByDisplayValue(
      "obj3 = obj1",
    ) as HTMLInputElement;
    expect(operation.disabled).toBe(true);
  });

  it("round-trips through resolveCallbacks and refreshes the computed field", async () => {
    const resolveCallbacks = vi.fn(
      async (_name: string, vals: Record<string, unknown>) => ({
        ...vals,
        operation: `obj3 = (obj1 + obj2) x ${vals.factor}`,
      }),
    );

    render(<ControlledForm resolveCallbacks={resolveCallbacks} />);

    const factor = screen.getByDisplayValue("1") as HTMLInputElement;
    fireEvent.change(factor, { target: { value: "3" } });

    expect(resolveCallbacks).toHaveBeenCalledWith(
      "factor",
      expect.objectContaining({ factor: 3 }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("obj3 = (obj1 + obj2) x 3")).toBeTruthy(),
    );
  });

  it("does not call resolveCallbacks for fields without a callback", () => {
    const resolveCallbacks = vi.fn(
      async (_n: string, v: Record<string, unknown>) => v,
    );
    render(
      <ControlledForm
        resolveCallbacks={resolveCallbacks}
        initial={{ factor: 1, operation: "x" }}
      />,
    );
    // ``operation`` is disabled and has no callback flag; nothing to fire.
    expect(resolveCallbacks).not.toHaveBeenCalled();
  });
});
