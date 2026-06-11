/**
 * Modal dialog wrapping a DataSetForm.
 *
 * Used by App.tsx to collect parameters for any Sigima processing whose
 * catalogue entry declares a ``paramclass``. Schema/values come from
 * Python via :func:`bootstrap.get_processing_schema`.
 */

import { useState } from "react";
import { DataSetForm } from "./DataSetForm";
import { t } from "../i18n/translate";
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
  resolveCallbacks?: (
    itemName: string,
    currentValues: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  resolveActive?: (
    currentValues: Record<string, unknown>,
  ) => Promise<Record<string, boolean>>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}

export function DataSetDialog(props: Props) {
  const {
    title,
    payload,
    resolveChoices,
    resolveCallbacks,
    resolveActive,
    onSubmit,
    onCancel,
  } = props;
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
        {description && (
          <p
            className="dataset-dialog-desc"
            dangerouslySetInnerHTML={{ __html: description }}
          />
        )}
        <DataSetForm
          schema={payload.schema}
          values={values}
          onChange={setValues}
          resolveChoices={resolveChoices}
          resolveCallbacks={resolveCallbacks}
          resolveActive={resolveActive}
        />
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={submitting}>
            {t("Cancel")}
          </button>
          <button onClick={submit} disabled={submitting}>
            {submitting ? t("Applying…") : t("OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
