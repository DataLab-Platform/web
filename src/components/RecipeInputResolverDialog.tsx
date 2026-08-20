import { useMemo, useState } from "react";
import { t } from "../i18n/translate";
import type { PluginRecipePreparation } from "../runtime/runtime";

interface Props {
  preparation: PluginRecipePreparation;
  onSubmit: (bindings: Record<string, string[]>) => void | Promise<void>;
  onCancel: () => void;
}

export function RecipeInputResolverDialog({
  preparation,
  onSubmit,
  onCancel,
}: Props) {
  const [bindings, setBindings] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      preparation.slots.map((slot) => [
        slot.id,
        [...(preparation.bindings[slot.id] ?? [])],
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(
    () =>
      preparation.slots.every((slot) => {
        const count = bindings[slot.id]?.length ?? 0;
        if (slot.required && count === 0) return false;
        return slot.cardinality === "many" || count <= 1;
      }),
    [bindings, preparation.slots],
  );

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(bindings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Recipe inputs")}
    >
      <div className="card recipe-input-dialog">
        <h2>{t("Recipe inputs")}</h2>
        <div className="recipe-slot-list">
          {preparation.slots.map((slot) => {
            const candidates = preparation.candidates.filter((candidate) =>
              candidate.compatible_slots.includes(slot.id),
            );
            const selected = bindings[slot.id] ?? [];
            return (
              <fieldset className="recipe-slot" key={slot.id}>
                <legend>
                  <span>{slot.id.replaceAll("_", " ")}</span>
                  <small>
                    {slot.object_type === "signal" ? t("Signal") : t("Image")}
                    {slot.required ? ` · ${t("Required")}` : ""}
                  </small>
                </legend>
                {slot.cardinality === "one" ? (
                  <select
                    aria-label={slot.id}
                    value={selected[0] ?? ""}
                    onChange={(event) =>
                      setBindings((current) => ({
                        ...current,
                        [slot.id]: event.target.value
                          ? [event.target.value]
                          : [],
                      }))
                    }
                  >
                    <option value="">{t("Not assigned")}</option>
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </option>
                    ))}
                  </select>
                ) : candidates.length > 0 ? (
                  <div className="recipe-candidate-list">
                    {candidates.map((candidate) => (
                      <label key={candidate.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(candidate.id)}
                          onChange={(event) =>
                            setBindings((current) => {
                              const values = current[slot.id] ?? [];
                              return {
                                ...current,
                                [slot.id]: event.target.checked
                                  ? [...values, candidate.id]
                                  : values.filter((id) => id !== candidate.id),
                              };
                            })
                          }
                        />
                        <span>{candidate.title}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="recipe-empty">{t("No compatible object")}</p>
                )}
              </fieldset>
            );
          })}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={submitting}>
            {t("Cancel")}
          </button>
          <button onClick={submit} disabled={submitting || !valid}>
            {submitting ? t("Applying…") : t("Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
