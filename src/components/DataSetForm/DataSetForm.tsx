/**
 * DataSetForm — render a guidata DataSet schema as a React form.
 *
 * Consumes a JSON Schema 2020-12 document produced by
 * ``guidata.dataset.dataset_to_schema``, augmented with ``x-guidata-*``
 * extension keywords. Each property is dispatched to a leaf widget based
 * on its ``x-guidata-kind`` value.
 *
 * Supported kinds: int, float, bool, string, text, choice,
 * multiple_choice, image_choice, color, date, datetime, file,
 * float_array (read-only JSON), dict (raw JSON textarea).
 *
 * Layout (groups, tabs) is taken from the ``x-guidata-layout`` key.
 * Falls back to a flat property order when that key is missing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DynamicChoice, JsonSchema } from "../../runtime/runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Values = Record<string, unknown>;

export interface DataSetFormProps {
  schema: JsonSchema;
  values: Values;
  onChange: (values: Values) => void;
  /** Resolver for dynamic ChoiceItems (when a property carries
   *  ``x-guidata-choices-dynamic``). */
  resolveChoices?: (
    itemName: string,
    currentValues: Values,
  ) => Promise<DynamicChoice[]>;
}

// Layout node as emitted by the Python side. Either a property name
// (string leaf) or a container with kind/label/items.
type LayoutLeaf = string;
type LayoutContainer = {
  kind: "group" | "tab-group" | "tab" | "separator";
  label?: string;
  items?: LayoutNode[];
};
type LayoutNode = LayoutLeaf | LayoutContainer;

// ---------------------------------------------------------------------------
// Top-level form
// ---------------------------------------------------------------------------

export function DataSetForm(props: DataSetFormProps) {
  const { schema, values, onChange, resolveChoices } = props;
  const properties = (schema.properties as Record<string, JsonSchema>) ?? {};
  const layout =
    (schema["x-guidata-layout"] as LayoutNode[] | undefined) ??
    (schema["x-guidata-property-order"] as string[] | undefined) ??
    Object.keys(properties);

  const setValue = useCallback(
    (name: string, value: unknown) => {
      onChange({ ...values, [name]: value });
    },
    [onChange, values],
  );

  return (
    <div className="dataset-form">
      {layout.map((node, idx) => (
        <LayoutNodeView
          key={idx}
          node={node}
          properties={properties}
          values={values}
          setValue={setValue}
          resolveChoices={resolveChoices}
        />
      ))}
    </div>
  );
}

interface NodeProps {
  node: LayoutNode;
  properties: Record<string, JsonSchema>;
  values: Values;
  setValue: (name: string, value: unknown) => void;
  resolveChoices?: DataSetFormProps["resolveChoices"];
}

function LayoutNodeView({
  node,
  properties,
  values,
  setValue,
  resolveChoices,
}: NodeProps) {
  if (typeof node === "string") {
    const prop = properties[node];
    if (!prop) return null;
    if (prop["x-guidata-hide"] === true) return null;
    return (
      <FieldRow
        name={node}
        prop={prop}
        value={values[node]}
        onChange={(v) => setValue(node, v)}
        currentValues={values}
        resolveChoices={resolveChoices}
      />
    );
  }
  if (node.kind === "separator") {
    return <hr className="dataset-form-separator" />;
  }
  if (node.kind === "tab-group") {
    return (
      <TabGroup
        node={node}
        properties={properties}
        values={values}
        setValue={setValue}
        resolveChoices={resolveChoices}
      />
    );
  }
  // group or tab (when used outside a tab-group, "tab" still renders fine
  // as a labelled fieldset)
  return (
    <fieldset className="dataset-form-group">
      {node.label && (
        <legend dangerouslySetInnerHTML={{ __html: node.label }} />
      )}
      {(node.items ?? []).map((child, idx) => (
        <LayoutNodeView
          key={idx}
          node={child}
          properties={properties}
          values={values}
          setValue={setValue}
          resolveChoices={resolveChoices}
        />
      ))}
    </fieldset>
  );
}

function TabGroup({
  node,
  properties,
  values,
  setValue,
  resolveChoices,
}: {
  node: LayoutContainer;
  properties: Record<string, JsonSchema>;
  values: Values;
  setValue: (name: string, value: unknown) => void;
  resolveChoices?: DataSetFormProps["resolveChoices"];
}) {
  const tabs = (node.items ?? []).filter(
    (n): n is LayoutContainer => typeof n !== "string" && n.kind === "tab",
  );
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  return (
    <div className="dataset-form-tabs">
      <div className="dataset-form-tab-bar">
        {tabs.map((t, idx) => (
          <button
            key={idx}
            type="button"
            className={idx === active ? "active" : ""}
            onClick={() => setActive(idx)}
            dangerouslySetInnerHTML={{
              __html: t.label || `Tab ${idx + 1}`,
            }}
          />
        ))}
      </div>
      <div className="dataset-form-tab-body">
        {(tabs[active].items ?? []).map((child, idx) => (
          <LayoutNodeView
            key={idx}
            node={child}
            properties={properties}
            values={values}
            setValue={setValue}
            resolveChoices={resolveChoices}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row + dispatch
// ---------------------------------------------------------------------------

interface FieldRowProps {
  name: string;
  prop: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  currentValues: Values;
  resolveChoices?: DataSetFormProps["resolveChoices"];
}

function FieldRow(props: FieldRowProps) {
  const { name, prop } = props;
  const label = (prop["x-guidata-label"] as string | undefined) ?? name;
  const help = prop.description as string | undefined;
  const unit = prop["x-guidata-unit"] as string | undefined;
  const readOnly = prop.readOnly === true;
  return (
    <div className="dataset-form-row">
      <label
        className="dataset-form-label"
        title={help}
        dangerouslySetInnerHTML={{ __html: label }}
      />
      <div className="dataset-form-control">
        <FieldWidget {...props} disabled={readOnly} />
        {unit && <span className="dataset-form-unit">{unit}</span>}
      </div>
    </div>
  );
}

function FieldWidget(props: FieldRowProps & { disabled?: boolean }) {
  const kind = props.prop["x-guidata-kind"] as string | undefined;
  switch (kind) {
    case "int":
      return <NumericField {...props} integer />;
    case "float":
      return <NumericField {...props} integer={false} />;
    case "bool":
      return <BoolField {...props} />;
    case "string":
      return <StringField {...props} multiline={false} />;
    case "text":
      return <StringField {...props} multiline />;
    case "choice":
      return <ChoiceField {...props} />;
    case "multiple_choice":
      return <MultipleChoiceField {...props} />;
    case "image_choice":
      return <ImageChoiceField {...props} />;
    case "color":
      return <ColorField {...props} />;
    case "date":
      return <DateField {...props} withTime={false} />;
    case "datetime":
      return <DateField {...props} withTime />;
    case "file":
      return <FileField {...props} />;
    case "float_array":
      return <FloatArrayField {...props} />;
    case "dict":
      return <JsonField {...props} />;
    default:
      return <JsonField {...props} />;
  }
}

// ---------------------------------------------------------------------------
// Leaf widgets
// ---------------------------------------------------------------------------

type LeafProps = FieldRowProps & { disabled?: boolean };

function NumericField({
  prop,
  value,
  onChange,
  disabled,
  integer,
}: LeafProps & { integer: boolean }) {
  const min = prop.minimum as number | undefined;
  const max = prop.maximum as number | undefined;
  const step = integer
    ? 1
    : ((prop["x-guidata-step"] as number | undefined) ?? "any");
  const slider = prop["x-guidata-slider"] === true;
  const handle = (raw: string) => {
    if (raw === "") {
      onChange(null);
      return;
    }
    const n = integer ? parseInt(raw, 10) : parseFloat(raw);
    onChange(Number.isFinite(n) ? n : null);
  };
  const v = value == null ? "" : String(value);
  return (
    <input
      type={slider ? "range" : "number"}
      value={v}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => handle(e.target.value)}
    />
  );
}

function BoolField({ prop, value, onChange, disabled }: LeafProps) {
  const text = prop["x-guidata-text"] as string | undefined;
  return (
    <label className="dataset-form-check">
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {text && <span>{text}</span>}
    </label>
  );
}

function StringField({
  prop,
  value,
  onChange,
  disabled,
  multiline,
}: LeafProps & { multiline: boolean }) {
  const v = value == null ? "" : String(value);
  const pattern = prop.pattern as string | undefined;
  const password = prop["x-guidata-password"] === true;
  if (multiline) {
    return (
      <textarea
        value={v}
        rows={4}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type={password ? "password" : "text"}
      value={v}
      pattern={pattern}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface ChoiceEntry {
  value: unknown;
  label: string;
  icon?: string;
}

function useChoices(
  prop: JsonSchema,
  name: string,
  currentValues: Values,
  resolveChoices?: DataSetFormProps["resolveChoices"],
): ChoiceEntry[] {
  const isDynamic = prop["x-guidata-choices-dynamic"] === true;
  const staticChoices =
    (prop["x-guidata-choices"] as ChoiceEntry[] | undefined) ?? [];
  const [dynamic, setDynamic] = useState<ChoiceEntry[]>([]);
  // Re-resolve on dependencies changing values (cheap: front-end serialises
  // by JSON of the visible state).
  const valuesKey = useMemo(
    () => JSON.stringify(currentValues),
    [currentValues],
  );
  // NOTE: this MUST be ``useEffect`` (not ``useMemo``).  ``useMemo`` does
  // not run cleanup callbacks, so the ``cancelled`` flag would never flip
  // and the *last-resolving* request would win — a real race condition
  // when ``currentValues`` change faster than the Python round-trip.
  useEffect(() => {
    if (!isDynamic || !resolveChoices) return;
    let cancelled = false;
    resolveChoices(name, currentValues).then((entries) => {
      if (!cancelled) setDynamic(entries);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDynamic, name, valuesKey, resolveChoices]);
  return isDynamic ? dynamic : staticChoices;
}

function ChoiceField(props: LeafProps) {
  const {
    prop,
    value,
    onChange,
    disabled,
    currentValues,
    name,
    resolveChoices,
  } = props;
  const choices = useChoices(prop, name, currentValues, resolveChoices);
  return (
    <select
      value={String(value ?? "")}
      disabled={disabled}
      onChange={(e) => {
        const idx = e.target.selectedIndex;
        onChange(choices[idx]?.value);
      }}
    >
      {choices.map((c, idx) => (
        <option key={idx} value={String(c.value)}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function MultipleChoiceField(props: LeafProps) {
  const {
    prop,
    value,
    onChange,
    disabled,
    currentValues,
    name,
    resolveChoices,
  } = props;
  const choices = useChoices(prop, name, currentValues, resolveChoices);
  const selected = new Set(Array.isArray(value) ? value : []);
  return (
    <div className="dataset-form-multichoice">
      {choices.map((c, idx) => (
        <label key={idx} className="dataset-form-check">
          <input
            type="checkbox"
            checked={selected.has(c.value)}
            disabled={disabled}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(c.value);
              else next.delete(c.value);
              onChange(Array.from(next));
            }}
          />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}

function ImageChoiceField(props: LeafProps) {
  const {
    prop,
    value,
    onChange,
    disabled,
    currentValues,
    name,
    resolveChoices,
  } = props;
  const choices = useChoices(prop, name, currentValues, resolveChoices);
  return (
    <div className="dataset-form-imagechoice">
      {choices.map((c, idx) => {
        const sel = c.value === value;
        return (
          <button
            type="button"
            key={idx}
            className={sel ? "selected" : ""}
            disabled={disabled}
            onClick={() => onChange(c.value)}
            title={c.label}
          >
            {c.icon && <img src={c.icon} alt="" />}
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ColorField({ value, onChange, disabled }: LeafProps) {
  const v = typeof value === "string" && value ? value : "#000000";
  return (
    <input
      type="color"
      value={v}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DateField({
  value,
  onChange,
  disabled,
  withTime,
}: LeafProps & { withTime: boolean }) {
  // Browsers expect "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" — we strip seconds/ms
  // from the ISO form Python produces.
  const raw = typeof value === "string" ? value : "";
  const v = withTime ? raw.slice(0, 16) : raw.slice(0, 10);
  return (
    <input
      type={withTime ? "datetime-local" : "date"}
      value={v}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

function FileField({ prop, value, onChange, disabled }: LeafProps) {
  // The browser cannot select arbitrary local paths. We expose a free-text
  // input as a placeholder; a richer picker requires File System Access API.
  const mode = prop["x-guidata-file-mode"] as string | undefined;
  const isMulti = mode === "open-multi";
  if (isMulti) {
    const list = Array.isArray(value) ? (value as unknown[]).join("; ") : "";
    return (
      <input
        type="text"
        value={list}
        placeholder="path1; path2; …"
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }
  const v = typeof value === "string" ? value : "";
  return (
    <input
      type="text"
      value={v}
      placeholder={mode === "directory" ? "directory path" : "file path"}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FloatArrayField({ value, onChange, disabled }: LeafProps) {
  // 1-D only for the MVP; the user types a comma-separated list. Multi-D
  // editing needs a dedicated grid widget — out of scope here.
  const arr = Array.isArray(value) ? (value as number[]) : [];
  const text = arr.join(", ");
  return (
    <input
      type="text"
      value={text}
      placeholder="1, 2, 3, …"
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => Number.isFinite(n));
        onChange(next);
      }}
    />
  );
}

function JsonField({ value, onChange, disabled }: LeafProps) {
  const [text, setText] = useState(() =>
    JSON.stringify(value ?? null, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="dataset-form-json">
      <textarea
        rows={4}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(null);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error && <span className="dataset-form-error">{error}</span>}
    </div>
  );
}
