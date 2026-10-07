import { useEffect, useRef } from "react";
import { t } from "../i18n/translate";
import type {
  PluginExampleSummary,
  PluginRecipeAssessment,
  PluginRecipeSummary,
} from "../runtime/runtime";
import { formatReadiness, formatSlotKind } from "../utils/recipeInputs";

interface Props {
  recipe: PluginRecipeSummary;
  /** Examples designed for this recipe. */
  examples: PluginExampleSummary[];
  /** Readiness on the current selection; undefined while it is checked. */
  assessment: PluginRecipeAssessment | undefined;
  /** Name shared by the exclusive accordion items of an application. */
  group: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  focused: boolean;
  disabled: boolean;
  onRun: () => void;
  onTryExample: (exampleId: string) => void;
}

/** One method of an application: expected inputs, readiness and examples. */
export function ApplicationMethodCard({
  recipe,
  examples,
  assessment,
  group,
  open,
  onToggle,
  focused,
  disabled,
  onRun,
  onTryExample,
}: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // jsdom does not implement scrollIntoView
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  const readiness = assessment
    ? formatReadiness(assessment, recipe.inputs)
    : null;
  const status = assessment?.status ?? "pending";
  const summary = readiness?.summary ?? t("Checking the current selection…");
  return (
    <details
      ref={ref}
      className={`application-method${focused ? " focused" : ""}`}
      data-recipe-id={recipe.id}
      name={group}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary title={summary}>
        <span
          className={`application-readiness-dot readiness-${status}`}
          data-readiness={status}
          role="img"
          aria-label={summary}
        />
        <strong>{recipe.title}</strong>
        <span className="application-method-version">v{recipe.version}</span>
      </summary>
      <div className="application-accordion-body">
        <header className="application-method-header">
          <div>{recipe.description && <p>{recipe.description}</p>}</div>
          <button onClick={onRun} disabled={disabled}>
            {t("Run on selection…")}
          </button>
        </header>
        {recipe.inputs.length > 0 && (
          <div className="application-method-inputs">
            <span className="application-method-label">
              {t("Expected inputs")}
            </span>
            <ul>
              {recipe.inputs.map((slot) => (
                <li key={slot.id} data-slot-id={slot.id}>
                  <strong>{slot.title}</strong>{" "}
                  <span className="application-slot-kind">
                    {formatSlotKind(slot)}
                  </span>
                  {slot.description && <p>{slot.description}</p>}
                  {slot.metadata.length > 0 && (
                    <ul className="application-slot-metadata">
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
                </li>
              ))}
            </ul>
          </div>
        )}
        <div
          className={`application-readiness readiness-${status}`}
          role="status"
        >
          <span className="application-readiness-summary">{summary}</span>
          {readiness && readiness.reasons.length > 0 && (
            <ul>
              {readiness.reasons.map((reason, index) => (
                <li key={`${index}:${reason}`}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
        {examples.length > 0 && (
          <div className="application-method-examples">
            <span className="application-method-label">
              {t("Examples designed for this method")}
            </span>
            {examples.map((example) => (
              <div
                className="application-method-example"
                data-example-id={example.id}
                key={example.id}
              >
                <div>
                  <strong>{example.title}</strong>
                  {example.description && <p>{example.description}</p>}
                </div>
                <button
                  onClick={() => onTryExample(example.id)}
                  disabled={disabled}
                >
                  {t("Try with this example")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
