import type { JsonSchema } from "../../runtime/runtime";

export function numericValueValid(prop: JsonSchema, value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (prop["x-guidata-check-value"] === false) return true;
  if (prop["x-guidata-kind"] === "int" && !Number.isInteger(value))
    return false;
  if (typeof prop.minimum === "number" && value < prop.minimum) return false;
  if (typeof prop.maximum === "number" && value > prop.maximum) return false;
  if (prop["x-guidata-nonzero"] === true && value === 0) return false;
  const even = prop["x-guidata-even"];
  return (
    !(even === true && value % 2 !== 0) && !(even === false && value % 2 === 0)
  );
}

export function fieldEditable(
  name: string,
  prop: JsonSchema,
  overrides: Record<string, boolean>,
): boolean {
  return (
    prop.readOnly !== true &&
    (overrides[name] ?? prop["x-guidata-active"]) !== false
  );
}

export function histogramRangeState(
  name: string,
  prop: JsonSchema,
  properties: Record<string, JsonSchema>,
  values: Record<string, unknown>,
  overrides: Record<string, boolean> = {},
) {
  const minimumField = String(prop["x-guidata-minimum-field"] ?? "minimum");
  const maximumField = String(prop["x-guidata-maximum-field"] ?? "maximum");
  const minimumProp = properties[minimumField];
  const maximumProp = properties[maximumField];
  const linked =
    minimumField !== maximumField &&
    minimumProp?.["x-guidata-kind"] === "float" &&
    maximumProp?.["x-guidata-kind"] === "float";
  const editable =
    linked &&
    fieldEditable(name, prop, overrides) &&
    fieldEditable(minimumField, minimumProp, overrides) &&
    fieldEditable(maximumField, maximumProp, overrides);
  const minimum = values[minimumField];
  const maximum = values[maximumField];
  const valid =
    linked &&
    numericValueValid(minimumProp, minimum) &&
    numericValueValid(maximumProp, maximum) &&
    (minimum as number) < (maximum as number);
  return { editable, valid, minimumProp, maximumProp };
}
