import { useCallback, useEffect, useMemo, useState } from "react";
import { getRootIconUrl } from "../assets/rootIcons";
import { t } from "../i18n/translate";
import { useRuntime } from "../runtime/RuntimeContext";
import type {
  PluginExampleOpenResult,
  PluginRecipeAssessment,
  PluginRecord,
  PluginRecipeCommit,
  PluginRecipePreparation,
} from "../runtime/runtime";
import { ApplicationMethodCard } from "./ApplicationMethodCard";
import { DataSetDialog } from "./DataSetDialog";
import { RecipeInputResolverDialog } from "./RecipeInputResolverDialog";

/** Last example opened from an application plugin. */
export interface PluginExampleContext {
  pluginId: string;
  /** Every object selected by the example. */
  objectIds: string[];
  /** Objects visibly selected after opening it (possibly fewer). */
  visibleIds: string[];
  /** Parameter values suited to the example, per recipe ID. */
  parameterValues: Record<string, Record<string, unknown>>;
}

interface Props {
  candidateIds: string[];
  exampleContext?: PluginExampleContext | null;
  initialTarget?: { pluginId: string; recipeId: string } | null;
  confirmOpenExample: () => boolean | Promise<boolean>;
  onCommitted: (commit: PluginRecipeCommit) => void | Promise<void>;
  onExampleOpened: (result: PluginExampleOpenResult) => void | Promise<void>;
  onClose: () => void;
}

interface PendingParameters {
  preparation: PluginRecipePreparation;
  bindings: Record<string, string[]>;
}

interface PendingInputs {
  preparation: PluginRecipePreparation;
  values: Record<string, unknown>;
}

/** Delay before assessing the recipes on a new selection. */
const READINESS_DELAY_MS = 250;

function isApplication(record: PluginRecord): boolean {
  return Boolean(
    record.enabled &&
    record.loaded &&
    record.plugin_id &&
    record.info?.capabilities.includes("application") &&
    (record.recipes.length > 0 || record.examples.length > 0),
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Return the example values of a recipe when all candidates come from it. */
function exampleValuesFor(
  context: PluginExampleContext | null,
  pluginId: string,
  recipeId: string,
  candidateIds: string[],
): Record<string, unknown> {
  if (!context || context.pluginId !== pluginId || candidateIds.length === 0) {
    return {};
  }
  const exampleIds = new Set(context.objectIds);
  return candidateIds.every((id) => exampleIds.has(id))
    ? (context.parameterValues[recipeId] ?? {})
    : {};
}

/** Prefill the parameter form of a preparation with example values. */
function withValues(
  preparation: PluginRecipePreparation,
  values: Record<string, unknown>,
): PluginRecipePreparation {
  if (!preparation.parameters || Object.keys(values).length === 0) {
    return preparation;
  }
  return {
    ...preparation,
    parameters: {
      ...preparation.parameters,
      values: { ...preparation.parameters.values, ...values },
    },
  };
}

export function ApplicationsDialog({
  candidateIds,
  exampleContext = null,
  initialTarget = null,
  confirmOpenExample,
  onCommitted,
  onExampleOpened,
  onClose,
}: Props) {
  const { runtime } = useRuntime();
  const [records, setRecords] = useState<PluginRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTarget?.pluginId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<
    PluginRecipeCommit["diagnostics"]
  >([]);
  const [assessments, setAssessments] = useState<
    Record<string, PluginRecipeAssessment>
  >({});
  const [pendingInputs, setPendingInputs] = useState<PendingInputs | null>(
    null,
  );
  const [pendingParameters, setPendingParameters] =
    useState<PendingParameters | null>(null);

  useEffect(() => {
    if (initialTarget) setSelectedId(initialTarget.pluginId);
  }, [initialTarget]);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    runtime
      .listPlugins()
      .then((items) => {
        if (cancelled) return;
        const applications = items.filter(isApplication);
        setRecords(applications);
        setSelectedId((current) =>
          applications.some((record) => record.plugin_id === current)
            ? current
            : (applications[0]?.plugin_id ?? null),
        );
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !busy &&
        !pendingInputs &&
        !pendingParameters
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, pendingInputs, pendingParameters]);

  const selected = useMemo(
    () => records.find((record) => record.plugin_id === selectedId) ?? null,
    [records, selectedId],
  );

  // Live readiness of every method on the current selection. Keys keep the
  // effect from re-running when App re-creates equal arrays.
  const selectedPluginId = selected?.plugin_id ?? null;
  const recipeKey = selected?.recipes.map((recipe) => recipe.id).join("\n");
  const candidateKey = candidateIds.join("\n");
  useEffect(() => {
    if (!runtime || !selectedPluginId || !recipeKey || busy) return;
    let cancelled = false;
    const recipeIds = recipeKey.split("\n");
    const ids = candidateKey ? candidateKey.split("\n") : [];
    const timer = window.setTimeout(() => {
      const values = Object.fromEntries(
        recipeIds.map((recipeId) => [
          recipeId,
          exampleValuesFor(exampleContext, selectedPluginId, recipeId, ids),
        ]),
      );
      runtime
        .assessPluginRecipes(selectedPluginId, ids, values)
        .then((result) => {
          if (!cancelled) setAssessments(result);
        })
        .catch((reason) => {
          if (cancelled) return;
          const failure = {
            status: "error" as const,
            error: errorMessage(reason),
          };
          setAssessments(
            Object.fromEntries(recipeIds.map((id) => [id, failure])),
          );
        });
    }, READINESS_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    busy,
    candidateKey,
    exampleContext,
    recipeKey,
    runtime,
    selectedPluginId,
  ]);

  const execute = useCallback(
    async (
      preparation: PluginRecipePreparation,
      bindings: Record<string, string[]>,
      values: Record<string, unknown> = {},
    ) => {
      if (!runtime) return;
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const commit = await runtime.runPluginRecipe(
          preparation.plugin_id,
          preparation.recipe_id,
          bindings,
          values,
        );
        await onCommitted(commit);
        setDiagnostics(commit.diagnostics);
        setStatus(
          t("Created {count} objects", { count: commit.objects.length }),
        );
        setPendingParameters(null);
      } catch (reason) {
        setError(errorMessage(reason));
        throw reason;
      } finally {
        setBusy(false);
      }
    },
    [onCommitted, runtime],
  );

  const continuePreparation = useCallback(
    async (
      preparation: PluginRecipePreparation,
      bindings: Record<string, string[]>,
    ) => {
      setPendingInputs(null);
      if (preparation.parameters) {
        setPendingParameters({ preparation, bindings });
        return;
      }
      await execute(preparation, bindings);
    },
    [execute],
  );

  /** Assess the bindings edited in the input resolver. */
  const checkPendingBindings = useCallback(
    async (bindings: Record<string, string[]>) => {
      if (!runtime || !pendingInputs) {
        throw new Error("No recipe awaits its inputs");
      }
      return runtime.checkPluginRecipeBindings(
        pendingInputs.preparation.plugin_id,
        pendingInputs.preparation.recipe_id,
        bindings,
        pendingInputs.values,
      );
    },
    [pendingInputs, runtime],
  );

  /** Prepare a recipe; ask for the inputs unless they are ready to run. */
  const startRecipe = async (
    pluginId: string,
    recipeId: string,
    ids: string[],
    values: Record<string, unknown>,
  ) => {
    if (!runtime) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    setDiagnostics([]);
    try {
      const prepared = await runtime.preparePluginRecipe(
        pluginId,
        recipeId,
        ids,
        values,
      );
      const preparation = withValues(prepared, values);
      if (prepared.readiness.status === "ready") {
        await continuePreparation(preparation, prepared.readiness.bindings);
      } else {
        setPendingInputs({ preparation, values });
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const runOnSelection = (pluginId: string, recipeId: string) =>
    startRecipe(
      pluginId,
      recipeId,
      candidateIds,
      exampleValuesFor(exampleContext, pluginId, recipeId, candidateIds),
    );

  const openExample = async (
    pluginId: string,
    exampleId: string,
    recipeId: string | null,
  ): Promise<PluginExampleOpenResult | null> => {
    if (!runtime) return null;
    if (!(await confirmOpenExample())) return null;
    setBusy(true);
    setError(null);
    setStatus(null);
    setDiagnostics([]);
    try {
      const result = await runtime.openPluginExample(
        pluginId,
        exampleId,
        true,
        recipeId,
      );
      await onExampleOpened(result);
      setStatus(t("Example opened"));
      return result;
    } catch (reason) {
      setError(errorMessage(reason));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Open an example, then start the method on the objects it selects. */
  const tryExample = async (
    pluginId: string,
    exampleId: string,
    recipeId: string,
  ) => {
    const result = await openExample(pluginId, exampleId, recipeId);
    if (!result) return;
    await startRecipe(
      pluginId,
      recipeId,
      result.selected_ids,
      result.parameter_values[recipeId] ?? {},
    );
  };

  const datasets =
    selected?.examples.filter((example) => example.recipe_ids.length === 0) ??
    [];

  return (
    <>
      <div
        className="applications-window-layer"
        role="dialog"
        aria-label={t("Applications")}
      >
        <div className="card applications-dialog">
          <header className="applications-header">
            <div className="applications-header-title">
              <img
                className="applications-header-icon"
                src={getRootIconUrl("libre-gui-plugin.svg")}
                alt=""
                aria-hidden="true"
              />
              <h2>{t("Applications")}</h2>
            </div>
            <button
              className="dialog-close-button"
              onClick={onClose}
              disabled={busy}
              aria-label={t("Close")}
              title={t("Close")}
            >
              ×
            </button>
          </header>
          <div className="applications-layout">
            <nav className="applications-list" aria-label={t("Applications")}>
              {records.map((record) => (
                <button
                  key={record.plugin_id}
                  className={record.plugin_id === selectedId ? "active" : ""}
                  onClick={() => setSelectedId(record.plugin_id)}
                >
                  <strong>{record.info?.name ?? record.plugin_id}</strong>
                  <span>{record.info?.version ?? record.version}</span>
                </button>
              ))}
            </nav>
            <main className="applications-content">
              {!runtime && <p>{t("Runtime is not ready.")}</p>}
              {runtime && records.length === 0 && (
                <p className="recipe-empty">{t("No application available")}</p>
              )}
              {selected && (
                <>
                  <div className="application-title-row">
                    <div>
                      <h3>{selected.info?.name ?? selected.plugin_id}</h3>
                      {selected.info?.description && (
                        <p>{selected.info.description}</p>
                      )}
                    </div>
                    <div className="application-meta">
                      <span>{selected.info?.version ?? selected.version}</span>
                      {selected.trust === "unverified" && (
                        <span className="application-unverified">
                          {t("Unverified")}
                        </span>
                      )}
                    </div>
                  </div>

                  {selected.recipes.length > 0 && (
                    <section className="application-section">
                      <h4>{t("Methods")}</h4>
                      {selected.recipes.map((recipe) => (
                        <ApplicationMethodCard
                          key={recipe.id}
                          recipe={recipe}
                          examples={selected.examples.filter((example) =>
                            example.recipe_ids.includes(recipe.id),
                          )}
                          assessment={assessments[recipe.id]}
                          focused={recipe.id === initialTarget?.recipeId}
                          disabled={busy}
                          onRun={() =>
                            void runOnSelection(selected.plugin_id!, recipe.id)
                          }
                          onTryExample={(exampleId) =>
                            void tryExample(
                              selected.plugin_id!,
                              exampleId,
                              recipe.id,
                            )
                          }
                        />
                      ))}
                    </section>
                  )}

                  {datasets.length > 0 && (
                    <section className="application-section">
                      <h4>{t("Datasets")}</h4>
                      {datasets.map((example) => (
                        <div
                          className="application-entry"
                          data-example-id={example.id}
                          key={example.id}
                        >
                          <div>
                            <strong>{example.title}</strong>
                            {example.description && (
                              <p>{example.description}</p>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              void openExample(
                                selected.plugin_id!,
                                example.id,
                                null,
                              )
                            }
                            disabled={busy}
                          >
                            {t("Open dataset")}
                          </button>
                        </div>
                      ))}
                    </section>
                  )}

                  {selected.info?.documentation_url && (
                    <button
                      className="application-doc-button"
                      onClick={() =>
                        window.open(
                          selected.info!.documentation_url!,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      {t("Documentation")}
                    </button>
                  )}
                </>
              )}
            </main>
          </div>
          {error && <div className="error">{error}</div>}
          {status && <div className="applications-status">{status}</div>}
          {diagnostics.length > 0 && (
            <ul className="applications-diagnostics">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.level}:${diagnostic.code}:${index}`}>
                  <strong>{diagnostic.level}</strong> {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {pendingInputs && runtime && (
        <RecipeInputResolverDialog
          preparation={pendingInputs.preparation}
          onCheck={checkPendingBindings}
          onSubmit={(bindings) =>
            continuePreparation(pendingInputs.preparation, bindings)
          }
          onCancel={() => setPendingInputs(null)}
        />
      )}
      {pendingParameters?.preparation.parameters && runtime && (
        <DataSetDialog
          title={pendingParameters.preparation.title}
          payload={pendingParameters.preparation.parameters}
          resolveChoices={(itemName, values) =>
            runtime.resolvePluginRecipeChoices(
              pendingParameters.preparation.plugin_id,
              pendingParameters.preparation.recipe_id,
              itemName,
              values,
            )
          }
          resolveCallbacks={(itemName, values) =>
            runtime.resolvePluginRecipeCallbacks(
              pendingParameters.preparation.plugin_id,
              pendingParameters.preparation.recipe_id,
              itemName,
              values,
            )
          }
          resolveActive={(values) =>
            runtime.resolvePluginRecipeActive(
              pendingParameters.preparation.plugin_id,
              pendingParameters.preparation.recipe_id,
              values,
            )
          }
          onSubmit={(values) =>
            execute(
              pendingParameters.preparation,
              pendingParameters.bindings,
              values,
            )
          }
          onCancel={() => setPendingParameters(null)}
        />
      )}
    </>
  );
}
