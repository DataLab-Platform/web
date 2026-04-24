/**
 * Modal dialog wrapping a DataSetForm.
 *
 * Used by App.tsx to collect parameters for any Sigima processing whose
 * catalogue entry declares a ``paramclass``. Schema/values come from
 * Python via :func:`bootstrap.get_processing_schema`.
 */

import { useState } from "react";
import { DataSetForm } from "./DataSetForm";
import type {
  DynamicChoice,
  JsonSchema,
  SchemaWithValues,
} from "../runtime/runtime";

interface Props {
  title: string;
  payload: SchemaWithValues;
  resolveChoices?: (
    itemName: string,
    currentValues: Record<string, unknown>,
  ) => Promise<DynamicChoice[]>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}

export function DataSetDialog(props: Props) {
  const { title, payload, resolveChoices, onSubmit, onCancel } = props;
  const [values, setValues] = useState<Record<string, unknown>>(payload.values);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const description = (payload.schema as JsonSchema).description as
    | string
    | undefined;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card dataset-dialog">
        <h2>{title}</h2>
        {description && <p className="dataset-dialog-desc">{description}</p>}
        <DataSetForm
          schema={payload.schema}
          values={values}
          onChange={setValues}
          resolveChoices={resolveChoices}
        />
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}>
            {submitting ? "Applying…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
