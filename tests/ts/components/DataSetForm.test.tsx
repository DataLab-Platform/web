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

import {
  DataSetForm,
  validateDataSetValues,
} from "../../../src/components/DataSetForm";
import type { JsonSchema } from "../../../src/runtime/runtime";

vi.mock("react-plotly.js", () => ({
  default: (props: { data: Array<{ y?: unknown }> }) => (
    <div
      data-testid="histogram-plot"
      data-histogram={JSON.stringify(props.data[0]?.y)}
    />
  ),
}));

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

describe("DataSetForm labels", () => {
  it("shows only the checkbox text of an unlabeled BoolItem", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        shutter_open: {
          type: "boolean",
          "x-guidata-kind": "bool",
          "x-guidata-text": "Shutter open",
        },
        bare: { type: "boolean", "x-guidata-kind": "bool" },
      },
      "x-guidata-property-order": ["shutter_open", "bare"],
    };
    const { container } = render(
      <DataSetForm
        schema={schema}
        values={{ shutter_open: true, bare: false }}
        onChange={() => {}}
      />,
    );
    const labels = [...container.querySelectorAll(".dataset-form-label")];
    expect(labels.map((label) => label.textContent)).toEqual(["", "bare"]);
    expect(screen.getByLabelText("Shutter open")).toBeTruthy();
  });
});

describe("DataSetForm automatic sliders", () => {
  it("keeps exact numeric input beside an opt-in bounded slider", () => {
    const onChange = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      required: ["value"],
      properties: {
        value: {
          type: "number",
          minimum: 0,
          maximum: 1,
          "x-guidata-kind": "float",
          "x-guidata-label": "Value",
        },
      },
    };
    render(
      <DataSetForm
        schema={schema}
        values={{ value: 0.123456 }}
        onChange={onChange}
        autoSliders
      />,
    );

    const number = screen.getByRole("spinbutton") as HTMLInputElement;
    const range = screen.getByRole("slider") as HTMLInputElement;
    expect(number.type).toBe("number");
    expect(range.step).toBe("0.001");
    fireEvent.change(number, { target: { value: "0.123456789" } });
    expect(onChange).toHaveBeenCalledWith({ value: 0.123456789 });
  });

  it("aligns a parity-constrained integer slider with valid values", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["value"],
      properties: {
        value: {
          type: "integer",
          minimum: 0,
          maximum: 10,
          "x-guidata-kind": "int",
          "x-guidata-even": false,
        },
      },
    };
    render(
      <DataSetForm
        schema={schema}
        values={{ value: 3 }}
        onChange={() => undefined}
        autoSliders
      />,
    );

    const range = screen.getByRole("slider") as HTMLInputElement;
    expect(range.min).toBe("1");
    expect(range.max).toBe("9");
    expect(range.step).toBe("2");
    expect(validateDataSetValues(schema, { value: 3 })).toBe(true);
    expect(validateDataSetValues(schema, { value: 2 })).toBe(false);
  });

  it("respects a field-level automatic slider veto", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        value: {
          type: "number",
          minimum: 0,
          maximum: 1,
          "x-guidata-kind": "float",
          "x-guidata-auto-slider": false,
        },
      },
    };
    render(
      <DataSetForm
        schema={schema}
        values={{ value: 0.5 }}
        onChange={() => undefined}
        autoSliders
      />,
    );

    expect(screen.getByRole("spinbutton")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("reports the start and end of an automatic slider gesture", () => {
    const onSliderInteraction = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        value: {
          type: "number",
          minimum: 0,
          maximum: 1,
          "x-guidata-kind": "float",
        },
      },
    };
    render(
      <DataSetForm
        schema={schema}
        values={{ value: 0.5 }}
        onChange={() => undefined}
        autoSliders
        onSliderInteraction={onSliderInteraction}
      />,
    );

    const range = screen.getByRole("slider");
    fireEvent.pointerDown(range);
    fireEvent.pointerUp(range);
    expect(onSliderInteraction.mock.calls).toEqual([[true], [false]]);
  });

  it("reports resolver activity and ignores stale callback responses", async () => {
    let resolveFirst!: (value: Record<string, unknown>) => void;
    const first = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirst = resolve;
    });
    const stateChanges = vi.fn();
    const resolveCallbacks = vi.fn(async () => first);
    render(
      <ControlledFormWithState
        resolveCallbacks={resolveCallbacks}
        onStateChange={stateChanges}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("1"), {
      target: { value: "3" },
    });
    await waitFor(() =>
      expect(stateChanges).toHaveBeenLastCalledWith({
        valid: true,
        resolving: true,
      }),
    );
    fireEvent.change(screen.getByDisplayValue("obj3 = obj1"), {
      target: { value: "manual" },
    });
    resolveFirst({ factor: 3, operation: "stale" });
    await waitFor(() =>
      expect(stateChanges).toHaveBeenLastCalledWith({
        valid: true,
        resolving: false,
      }),
    );
    expect(screen.queryByDisplayValue("stale")).toBeNull();
  });
});

describe("DataSetForm histogram range", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      minimum: {
        type: "number",
        "x-guidata-kind": "float",
        "x-guidata-hide": true,
      },
      maximum: {
        type: "number",
        "x-guidata-kind": "float",
        "x-guidata-hide": true,
      },
      histogram: {
        type: "object",
        "x-guidata-kind": "histogram_range",
        "x-guidata-minimum-field": "minimum",
        "x-guidata-maximum-field": "maximum",
        "x-guidata-histogram-presentation": "brightness_contrast",
      },
    },
    "x-guidata-property-order": ["minimum", "maximum", "histogram"],
  };
  const histogram = {
    counts: [1, 4, 2, 1],
    bin_edges: [0, 25, 50, 75, 100],
    domain: [0, 100],
    y_max: 4,
    minimum_width: 1,
    reset_range: [0, 100],
    auto_range: [10, 90],
    active: true,
  };

  function ControlledHistogram(props: {
    schema?: JsonSchema;
    onSliderInteraction?: (dragging: boolean) => void;
    initial?: Record<string, unknown>;
    resolveCallbacks?: (
      itemName: string,
      values: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    onStateChange?: (state: { valid: boolean; resolving: boolean }) => void;
  }) {
    const [values, setValues] = useState<Record<string, unknown>>({
      minimum: 0,
      maximum: 100,
      histogram,
      ...props.initial,
    });
    return (
      <DataSetForm
        schema={props.schema ?? schema}
        values={values}
        onChange={setValues}
        onSliderInteraction={props.onSliderInteraction}
        resolveCallbacks={props.resolveCallbacks}
        onStateChange={props.onStateChange}
      />
    );
  }

  it("synchronizes Auto, brightness, contrast, and exact range inputs", async () => {
    render(<ControlledHistogram />);
    const plot = await screen.findByTestId("histogram-plot");
    const fixedCounts = plot.getAttribute("data-histogram");

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(10);
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(90);

    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "75" },
    });
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(
      -15,
    );
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(65);

    fireEvent.change(screen.getByRole("slider", { name: "Contrast" }), {
      target: { value: "25" },
    });
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(
      -75,
    );
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(
      125,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Contrast" }), {
      target: { value: "100" },
    });
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(
      24.5,
    );
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(
      25.5,
    );
    expect(plot.getAttribute("data-histogram")).toBe(fixedCounts);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(0);
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(
      100,
    );
  });

  it.each([
    ["Minimum", "2", 2, 2.0000000000000004],
    ["Maximum", "-2", -2.0000000000000004, -2],
  ])(
    "advances the opposite bound for %s outside a float64 domain",
    (name, input, lower, upper) => {
      render(
        <ControlledHistogram
          initial={{
            minimum: 0,
            maximum: 1,
            histogram: {
              ...histogram,
              domain: [0, 1],
              minimum_width: Number.EPSILON / 2,
            },
          }}
        />,
      );
      fireEvent.change(screen.getByRole("spinbutton", { name: String(name) }), {
        target: { value: input },
      });
      expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(
        lower,
      );
      expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(
        upper,
      );
    },
  );

  function boundedSchema(histogramProps: JsonSchema = {}): JsonSchema {
    const properties = schema.properties as Record<string, JsonSchema>;
    return {
      ...schema,
      properties: {
        ...properties,
        minimum: { ...properties.minimum, minimum: 0, maximum: 100 },
        maximum: { ...properties.maximum, minimum: 0, maximum: 100 },
        histogram: { ...properties.histogram, ...histogramProps },
      },
    };
  }

  it("validates hidden linked constraints without validating unrelated hidden fields", () => {
    const constrained = boundedSchema();
    expect(
      validateDataSetValues(constrained, {
        minimum: -5,
        maximum: 105,
        histogram,
      }),
    ).toBe(false);
    expect(
      validateDataSetValues(constrained, {
        minimum: 5,
        maximum: 105,
        histogram,
      }),
    ).toBe(false);
    expect(
      validateDataSetValues(schema, { minimum: -5, maximum: 105, histogram }),
    ).toBe(true);
    expect(
      validateDataSetValues(boundedSchema({ "x-guidata-active": false }), {
        minimum: -5,
        maximum: 105,
        histogram,
      }),
    ).toBe(true);
    expect(
      validateDataSetValues(
        {
          properties: {
            hidden: {
              "x-guidata-kind": "float",
              "x-guidata-hide": true,
              minimum: 0,
            },
          },
        },
        { hidden: -1 },
      ),
    ).toBe(true);
  });

  it("keeps constrained edits visible and invalid without invoking a callback", async () => {
    const resolver = vi.fn(async () => ({}));
    const state = vi.fn();
    render(
      <ControlledHistogram
        schema={boundedSchema({ "x-guidata-has-callback": true })}
        resolveCallbacks={resolver}
        onStateChange={state}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum" }), {
      target: { value: "-5" },
    });
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(-5);
    await waitFor(() =>
      expect(state).toHaveBeenLastCalledWith({
        valid: false,
        resolving: false,
      }),
    );
    expect(resolver).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("ignores a pending callback after a newer invalid range edit", async () => {
    let finish!: (values: Record<string, unknown>) => void;
    const resolver = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finish = resolve;
        }),
    );
    const state = vi.fn();
    render(
      <ControlledHistogram
        schema={boundedSchema({ "x-guidata-has-callback": true })}
        resolveCallbacks={resolver}
        onStateChange={state}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(resolver).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum" }), {
      target: { value: "-5" },
    });
    finish({ minimum: 20, maximum: 80 });
    await waitFor(() =>
      expect(state).toHaveBeenLastCalledWith({
        valid: false,
        resolving: false,
      }),
    );
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(-5);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("honors nonzero and the linked check=False opt-out", () => {
    const constrained = boundedSchema();
    const properties = constrained.properties as Record<string, JsonSchema>;
    properties.minimum["x-guidata-nonzero"] = true;
    expect(
      validateDataSetValues(constrained, {
        minimum: 0,
        maximum: 90,
        histogram,
      }),
    ).toBe(false);
    properties.minimum["x-guidata-check-value"] = false;
    expect(
      validateDataSetValues(constrained, {
        minimum: 0,
        maximum: 90,
        histogram,
      }),
    ).toBe(true);
    expect(
      validateDataSetValues(constrained, {
        minimum: -10,
        maximum: 90,
        histogram,
      }),
    ).toBe(true);
  });

  it("does not offer missing or malformed named ranges", () => {
    render(
      <ControlledHistogram
        initial={{
          histogram: {
            ...histogram,
            auto_range: [1, 1],
            reset_range: undefined,
          },
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Auto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("defaults to a generic interval presentation", async () => {
    render(
      <ControlledHistogram
        schema={boundedSchema({
          "x-guidata-histogram-presentation": undefined,
        })}
      />,
    );
    expect(screen.queryByRole("slider", { name: "Brightness" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Contrast" })).toBeNull();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(
      await screen.findByRole("img", { name: "Histogram and selected range" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(10);
  });

  it("disables the composite when a linked field is read-only", () => {
    const locked = boundedSchema();
    (locked.properties as Record<string, JsonSchema>).maximum.readOnly = true;
    render(<ControlledHistogram schema={locked} />);
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Auto" })).toBeDisabled();
  });

  it("reports one start/end pair for a slider gesture", () => {
    const onSliderInteraction = vi.fn();
    render(<ControlledHistogram onSliderInteraction={onSliderInteraction} />);
    const slider = screen.getByRole("slider", { name: "Minimum slider" });
    fireEvent.pointerDown(slider);
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(onSliderInteraction.mock.calls).toEqual([[true], [false]]);
  });

  it("disables controls without context while preserving saved bounds", () => {
    render(
      <ControlledHistogram
        initial={{ minimum: 10, maximum: 20, histogram: {} }}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(10);
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(20);
    for (const slider of screen.getAllByRole("slider")) {
      expect(slider).toBeDisabled();
    }
  });

  it("validates the hidden linked range fields", () => {
    expect(
      validateDataSetValues(schema, {
        minimum: 20,
        maximum: 10,
        histogram,
      }),
    ).toBe(false);
    expect(
      validateDataSetValues(schema, {
        minimum: 10,
        maximum: 20,
        histogram,
      }),
    ).toBe(true);
  });

  it("keeps an empty numeric bound invalid instead of coercing it to zero", async () => {
    const stateChanges = vi.fn();
    render(<ControlledHistogram onStateChange={stateChanges} />);

    const minimum = screen.getByRole("spinbutton", { name: "Minimum" });
    fireEvent.change(minimum, { target: { value: "" } });

    expect(minimum).toHaveValue(null);
    await waitFor(() =>
      expect(stateChanges).toHaveBeenLastCalledWith({
        valid: false,
        resolving: false,
      }),
    );
  });

  it("keeps every control finite over an extreme domain", () => {
    render(
      <ControlledHistogram
        initial={{
          minimum: -1e308,
          maximum: 1e308,
          histogram: {
            ...histogram,
            domain: [-1e308, 1e308],
            bin_edges: [-1e308, -5e307, 0, 5e307, 1e308],
            minimum_width: 2e292,
            reset_range: [-1e308, 1e308],
            auto_range: [-5e307, 5e307],
          },
        }}
      />,
    );
    for (const [name, position] of [
      ["Minimum slider", "250"],
      ["Maximum slider", "750"],
      ["Brightness", "25"],
      ["Contrast", "75"],
    ] as const) {
      fireEvent.change(screen.getByRole("slider", { name }), {
        target: { value: position },
      });
      const minimum = Number(
        (
          screen.getByRole("spinbutton", {
            name: "Minimum",
          }) as HTMLInputElement
        ).value,
      );
      const maximum = Number(
        (
          screen.getByRole("spinbutton", {
            name: "Maximum",
          }) as HTMLInputElement
        ).value,
      );
      expect(Number.isFinite(minimum)).toBe(true);
      expect(Number.isFinite(maximum)).toBe(true);
      expect(minimum).toBeLessThan(maximum);
    }
  });

  it("keeps the requested contrast over an extreme domain", () => {
    render(
      <ControlledHistogram
        initial={{
          minimum: -1e308,
          maximum: 1e308,
          histogram: {
            ...histogram,
            domain: [-1e308, 1e308],
            bin_edges: [-1e308, -5e307, 0, 5e307, 1e308],
            minimum_width: 2e292,
            reset_range: [-1e308, 1e308],
          },
        }}
      />,
    );

    const contrast = screen.getByRole("slider", { name: "Contrast" });
    fireEvent.change(contrast, { target: { value: "75" } });

    expect(screen.getByRole("spinbutton", { name: "Minimum" })).toHaveValue(
      -5e307,
    );
    expect(screen.getByRole("spinbutton", { name: "Maximum" })).toHaveValue(
      5e307,
    );
    expect(contrast).toHaveValue("75");
  });

  it("keeps zero contrast finite over a tiny domain", () => {
    render(
      <ControlledHistogram
        initial={{
          minimum: 0,
          maximum: 1e-30,
          histogram: {
            ...histogram,
            domain: [0, 1e-30],
            bin_edges: [0, 2.5e-31, 5e-31, 7.5e-31, 1e-30],
            minimum_width: 1e-45,
            reset_range: [0, 1e-30],
          },
        }}
      />,
    );

    const contrast = screen.getByRole("slider", { name: "Contrast" });
    fireEvent.change(contrast, { target: { value: "0" } });
    const minimum = screen.getByRole("spinbutton", { name: "Minimum" });
    const maximum = screen.getByRole("spinbutton", { name: "Maximum" });
    expect(Number.isFinite(Number((minimum as HTMLInputElement).value))).toBe(
      true,
    );
    expect(Number.isFinite(Number((maximum as HTMLInputElement).value))).toBe(
      true,
    );
    expect(Number((minimum as HTMLInputElement).value)).toBeLessThan(
      Number((maximum as HTMLInputElement).value),
    );
    expect(contrast).toHaveValue("0");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(minimum).toHaveValue(0);
    expect(maximum).toHaveValue(1e-30);
  });

  it("sends both linked values through the resolver pipeline", async () => {
    const resolver = vi.fn(
      async (_name: string, values: Record<string, unknown>) => values,
    );
    const callbackSchema: JsonSchema = {
      ...schema,
      properties: {
        ...(schema.properties as Record<string, JsonSchema>),
        histogram: {
          ...((schema.properties as Record<string, JsonSchema>)
            .histogram as JsonSchema),
          "x-guidata-has-callback": true,
        },
      },
    };
    function CallbackHistogram() {
      const [values, setValues] = useState<Record<string, unknown>>({
        minimum: 0,
        maximum: 100,
        histogram,
      });
      return (
        <DataSetForm
          schema={callbackSchema}
          values={values}
          onChange={setValues}
          resolveCallbacks={resolver}
        />
      );
    }
    render(<CallbackHistogram />);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    await waitFor(() =>
      expect(resolver).toHaveBeenCalledWith(
        "histogram",
        expect.objectContaining({ minimum: 10, maximum: 90 }),
      ),
    );
  });
});

function ControlledFormWithState(props: {
  resolveCallbacks: (
    itemName: string,
    values: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  onStateChange: (state: { valid: boolean; resolving: boolean }) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    factor: 1,
    operation: "obj3 = obj1",
  });
  return (
    <DataSetForm
      schema={SCHEMA}
      values={values}
      onChange={setValues}
      resolveCallbacks={props.resolveCallbacks}
      onStateChange={props.onStateChange}
    />
  );
}

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
