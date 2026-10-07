import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/translate";
import type {
  PluginRecipeCandidate,
  PluginRecipePreparation,
  PluginRecipeReadiness,
} from "../runtime/runtime";
import { formatReadiness, formatSlotKind } from "../utils/recipeInputs";

interface Props {
  preparation: PluginRecipePreparation;
  /** Assess edited bindings (slot declarations and recipe input checks). */
  onCheck: (
    bindings: Record<string, string[]>,
  ) => Promise<PluginRecipeReadiness>;
  onSubmit: (bindings: Record<string, string[]>) => void | Promise<void>;
  onCancel: () => void;
}

/** Delay before assessing bindings edited by the user. */
const CHECK_DELAY_MS = 200;

function candidateLabel(
  candidate: PluginRecipeCandidate,
  slotId: string,
): string {
  const missing = candidate.missing_metadata[slotId] ?? [];
  return missing.length > 0
    ? `${candidate.title} ${t("(missing: {keys})", { keys: missing.join(", ") })}`
    : candidate.title;
}

export function RecipeInputResolverDialog({
  preparation,
  onCheck,
  onSubmit,
  onCancel,
}: Props) {
  const [bindings, setBindings] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      preparation.slots.map((slot) => [
        slot.id,
        [...(preparation.readiness.bindings[slot.id] ?? [])],
      ]),
    ),
  );
  const initialBindings = useRef(bindings);
  const [readiness, setReadiness] = useState<PluginRecipeReadiness>(
    preparation.readiness,
  );
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bindings === initialBindings.current) return;
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      onCheck(bindings)
        .then((result) => {
          if (cancelled) return;
          setReadiness(result);
          setError(null);
        })
        .catch((reason) => {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bindings, onCheck]);

  const valid =
    !checking &&
    (readiness.status === "ready" || readiness.status === "warnings");
  const { summary, reasons } = formatReadiness(readiness, preparation.slots);

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
        <h2>{t("Inputs of '{title}'", { title: preparation.title })}</h2>
        <div className="recipe-slot-list">
          {preparation.slots.map((slot) => {
            const candidates = preparation.candidates.filter((candidate) =>
              candidate.compatible_slots.includes(slot.id),
            );
            const selected = bindings[slot.id] ?? [];
            return (
              <fieldset className="recipe-slot" key={slot.id}>
                <legend>
                  <span>{slot.title}</span>
                  <small>{formatSlotKind(slot)}</small>
                </legend>
                {slot.description && (
                  <p className="recipe-slot-description">{slot.description}</p>
                )}
                {slot.metadata.length > 0 && (
                  <ul className="recipe-slot-metadata">
                    {slot.metadata.map((requirement) => (
                      <li key={requirement.key}>
                        <code>{requirement.key}</code>{" "}
                        <span>
                          (
                          {requirement.required
                            ? t("required metadata")
                            : t("hint")}
                          )
                        </span>
                        {requirement.description &&
                          ` — ${requirement.description}`}
                      </li>
                    ))}
                  </ul>
                )}
                {slot.cardinality === "one" ? (
                  <select
                    aria-label={slot.title}
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
                        {candidateLabel(candidate, slot.id)}
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
                        <span>{candidateLabel(candidate, slot.id)}</span>
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
        <div
          className={`recipe-readiness readiness-${
            checking ? "pending" : readiness.status
          }`}
          data-readiness={checking ? "pending" : readiness.status}
          role="status"
        >
          <span className="application-readiness-summary">
            {checking ? t("Checking the current selection…") : summary}
          </span>
          {!checking && reasons.length > 0 && (
            <ul>
              {reasons.map((reason, index) => (
                <li key={`${index}:${reason}`}>{reason}</li>
              ))}
            </ul>
          )}
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
