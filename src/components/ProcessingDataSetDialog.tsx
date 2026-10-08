import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "../i18n/translate";
import type {
  DynamicChoice,
  FeatureDescriptor,
  JsonSchema,
  RuntimeApi,
  SchemaWithValues,
} from "../runtime/runtime";
import {
  DataSetForm,
  stripTransientValues,
  validateDataSetValues,
} from "./DataSetForm";
import {
  ProcessingPreview,
  type ProcessingPreviewHandle,
} from "./ProcessingPreview";

interface Props {
  title: string;
  payload: SchemaWithValues;
  runtime: RuntimeApi;
  previewAvailable: boolean;
  feature: FeatureDescriptor;
  sourceIds: string[];
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
  onSubmit: (
    values: Record<string, unknown>,
    previewToken?: string | null,
  ) => void | Promise<void>;
  onCancel: () => void;
}

export function ProcessingDataSetDialog(props: Props) {
  const {
    title,
    payload,
    runtime,
    previewAvailable,
    feature,
    sourceIds,
    resolveChoices,
    resolveCallbacks,
    resolveActive,
    onSubmit,
    onCancel,
  } = props;
  const [values, setValues] = useState<Record<string, unknown>>(payload.values);
  const [formState, setFormState] = useState({
    valid: validateDataSetValues(payload.schema, payload.values),
    resolving: resolveActive !== undefined,
  });
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<ProcessingPreviewHandle | null>(null);
  const canPreview =
    previewAvailable && feature.preview_enabled && feature.pattern === "1_to_1";
  const runtimeValues = stripTransientValues(payload.schema, values);

  const submit = async () => {
    if (!formState.valid || formState.resolving) return;
    const previewToken = previewRef.current?.takeCurrentResult() ?? null;
    previewRef.current?.stop();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(runtimeValues, previewToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = useCallback(() => {
    previewRef.current?.stop();
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) cancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancel, submitting]);

  const description = (payload.schema as JsonSchema).description as
    string | undefined;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div
        className={`card processing-dataset-dialog${canPreview ? " processing-dataset-dialog--preview" : ""}`}
      >
        <h2>{title}</h2>
        <div className="processing-dataset-dialog-body">
          <div className="processing-dataset-form">
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
              autoSliders
              onSliderInteraction={setDragging}
              onStateChange={setFormState}
            />
          </div>
          {canPreview && (
            <ProcessingPreview
              ref={previewRef}
              runtime={runtime}
              feature={feature}
              sourceIds={sourceIds}
              values={runtimeValues}
              valid={formState.valid}
              resolving={formState.resolving}
              dragging={dragging}
            />
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={cancel} disabled={submitting}>
            {t("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={submitting || !formState.valid || formState.resolving}
          >
            {submitting ? t("Applying…") : t("OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
