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

// A blob-detection-like schema: a controlling ``enable`` checkbox gates a
// dynamic-active ``gated`` field (``x-guidata-active-dynamic``). Mirrors
// ``BlobOpenCVParam.filter_by_circularity`` gating ``min_circularity``.
const GATED_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    enable: {
      type: "boolean",
      "x-guidata-kind": "bool",
      "x-guidata-label": "Enable",
      "x-guidata-name": "enable",
    },
    gated: {
      type: "number",
      "x-guidata-kind": "float",
      "x-guidata-label": "Gated",
      "x-guidata-name": "gated",
      // Inactive on open (default disabled) but dynamically re-evaluated.
      "x-guidata-active": false,
      "x-guidata-active-dynamic": true,
    },
  },
  "x-guidata-property-order": ["enable", "gated"],
};

function GatedForm(props: {
  resolveActive: (
    values: Record<string, unknown>,
  ) => Promise<Record<string, boolean>>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    enable: false,
    gated: 1,
  });
  return (
    <DataSetForm
      schema={GATED_SCHEMA}
      values={values}
      onChange={setValues}
      resolveActive={props.resolveActive}
    />
  );
}

describe("DataSetForm dynamic active state", () => {
  it("greys out a dynamic-active field and re-enables it on toggle", async () => {
    const resolveActive = vi.fn(async (vals: Record<string, unknown>) => ({
      enable: true,
      gated: vals.enable === true,
    }));

    render(<GatedForm resolveActive={resolveActive} />);

    // Initially disabled (baked ``x-guidata-active: false``); the mount
    // resolution confirms it.
    const gated = screen.getByDisplayValue("1") as HTMLInputElement;
    expect(gated.disabled).toBe(true);
    await waitFor(() => expect(resolveActive).toHaveBeenCalled());
    expect(gated.disabled).toBe(true);

    // Toggling the controlling checkbox re-resolves active and enables it.
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(resolveActive).toHaveBeenLastCalledWith(
      expect.objectContaining({ enable: true }),
    );
    await waitFor(() => expect(gated.disabled).toBe(false));
  });
});

// Blob-detection-exact schema: a controlling ``create_rois`` BoolItem gates a
// ``roi_geometry`` ChoiceItem, both nested inside a ``BeginGroup``. This locks
// in that the dynamic-active overrides reach fields rendered inside a group
// ``<fieldset>`` (the override flows through React context, not props).
const GROUPED_GATED_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    create_rois: {
      type: "boolean",
      "x-guidata-kind": "bool",
      "x-guidata-label": "Create regions of interest",
      "x-guidata-name": "create_rois",
    },
    roi_geometry: {
      type: "string",
      "x-guidata-kind": "choice",
      "x-guidata-label": "ROI geometry",
      "x-guidata-name": "roi_geometry",
      enum: ["rectangle", "circle"],
      "x-guidata-choices": [
        { value: "rectangle", label: "Rectangle" },
        { value: "circle", label: "Circle" },
      ],
      "x-guidata-active": false,
      "x-guidata-active-dynamic": true,
    },
  },
  "x-guidata-property-order": ["create_rois", "roi_geometry"],
  "x-guidata-layout": [
    {
      kind: "group",
      label: "Regions of interest",
      items: ["create_rois", "roi_geometry"],
    },
  ],
};

function GroupedGatedForm(props: {
  resolveActive: (
    values: Record<string, unknown>,
  ) => Promise<Record<string, boolean>>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    create_rois: false,
    roi_geometry: "rectangle",
  });
  return (
    <DataSetForm
      schema={GROUPED_GATED_SCHEMA}
      values={values}
      onChange={setValues}
      resolveActive={props.resolveActive}
    />
  );
}

describe("DataSetForm dynamic active inside a group", () => {
  it("greys/ungreys a gated field nested in a group when toggling the BoolItem", async () => {
    const resolveActive = vi.fn(async (vals: Record<string, unknown>) => ({
      create_rois: true,
      roi_geometry: vals.create_rois === true,
    }));

    render(<GroupedGatedForm resolveActive={resolveActive} />);

    // The gated ChoiceItem lives inside a <fieldset> group and starts
    // disabled (baked ``x-guidata-active: false``).
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.closest("fieldset")).not.toBeNull();
    expect(select.disabled).toBe(true);
    await waitFor(() => expect(resolveActive).toHaveBeenCalled());
    expect(select.disabled).toBe(true);

    // Checking ``create_rois`` re-enables the nested gated field.
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(select.disabled).toBe(false));

    // Unchecking it disables the nested field again.
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(select.disabled).toBe(true));
  });
});
