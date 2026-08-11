import { useCallback, useEffect, useMemo, useState } from "react";
import { getRootIconUrl } from "../assets/rootIcons";
import { t } from "../i18n/translate";
import { useRuntime } from "../runtime/RuntimeContext";
import type {
  PluginExampleOpenResult,
  PluginRecord,
  PluginRecipeCommit,
  PluginRecipePreparation,
} from "../runtime/runtime";
import { DataSetDialog } from "./DataSetDialog";
import { RecipeInputResolverDialog } from "./RecipeInputResolverDialog";

interface Props {
  candidateIds: string[];
  initialTarget?: {
    pluginId: string;
    recipeId: string;
    parameterValues: Record<string, unknown>;
    candidateIds?: string[];
  } | null;
  confirmOpenExample: () => boolean | Promise<boolean>;
  onCommitted: (commit: PluginRecipeCommit) => void | Promise<void>;
  onExampleOpened: (result: PluginExampleOpenResult) => void | Promise<void>;
  onClose: () => void;
}

interface PendingParameters {
  preparation: PluginRecipePreparation;
  bindings: Record<string, string[]>;
}

function isApplication(record: PluginRecord): boolean {
  return Boolean(
    record.enabled &&
    record.loaded &&
    record.plugin_id &&
    record.info?.capabilities.includes("application") &&
    (record.recipes.length > 0 || record.examples.length > 0),
  );
}

export function ApplicationsDialog({
  candidateIds,
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
  const [pendingInputs, setPendingInputs] =
    useState<PluginRecipePreparation | null>(null);
  const [pendingParameters, setPendingParameters] =
    useState<PendingParameters | null>(null);
  const [exampleParameters, setExampleParameters] = useState<
    Record<string, Record<string, unknown>>
  >(
    initialTarget
      ? { [initialTarget.recipeId]: initialTarget.parameterValues }
      : {},
  );
  const [exampleCandidateIds, setExampleCandidateIds] = useState<
    string[] | null
  >(initialTarget?.candidateIds ?? null);

  useEffect(() => {
    if (!initialTarget) return;
    setSelectedId(initialTarget.pluginId);
    setExampleParameters((current) => ({
      ...current,
      [initialTarget.recipeId]: initialTarget.parameterValues,
    }));
    setExampleCandidateIds(initialTarget.candidateIds ?? null);
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
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
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
        const message =
          reason instanceof Error ? reason.message : String(reason);
        setError(message);
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

  const startRecipe = async (pluginId: string, recipeId: string) => {
    if (!runtime) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const prepared = await runtime.preparePluginRecipe(
        pluginId,
        recipeId,
        exampleCandidateIds ?? candidateIds,
      );
      const defaults = exampleParameters[recipeId];
      const preparation =
        defaults && prepared.parameters
          ? {
              ...prepared,
              parameters: {
                ...prepared.parameters,
                values: { ...prepared.parameters.values, ...defaults },
              },
            }
          : prepared;
      if (
        preparation.ambiguous_slots.length > 0 ||
        preparation.missing_slots.length > 0
      ) {
        setPendingInputs(preparation);
      } else {
        await continuePreparation(preparation, preparation.bindings);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openExample = async (pluginId: string, exampleId: string) => {
    if (!runtime) return;
    if (!(await confirmOpenExample())) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await runtime.openPluginExample(pluginId, exampleId, true);
      setExampleCandidateIds(result.selected_ids);
      await onExampleOpened(result);
      if (result.recipe_id) {
        setExampleParameters((current) => ({
          ...current,
          [result.recipe_id!]: result.parameter_values,
        }));
      }
      setStatus(t("Example opened"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

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
                  onClick={() => {
                    setSelectedId(record.plugin_id);
                    setExampleCandidateIds(null);
                  }}
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
                      <h4>{t("Analyses")}</h4>
                      {selected.recipes.map((recipe) => (
                        <div
                          className={`application-entry${
                            recipe.id === initialTarget?.recipeId
                              ? " focused"
                              : ""
                          }`}
                          data-recipe-id={recipe.id}
                          key={recipe.id}
                        >
                          <div>
                            <strong>{recipe.title}</strong>
                            {recipe.description && <p>{recipe.description}</p>}
                          </div>
                          <button
                            onClick={() =>
                              void startRecipe(selected.plugin_id!, recipe.id)
                            }
                            disabled={busy}
                          >
                            {t("Start analysis…")}
                          </button>
                        </div>
                      ))}
                    </section>
                  )}

                  {selected.examples.length > 0 && (
                    <section className="application-section">
                      <h4>{t("Examples")}</h4>
                      {selected.examples.map((example) => (
                        <div className="application-entry" key={example.id}>
                          <div>
                            <strong>{example.title}</strong>
                            {example.description && (
                              <p>{example.description}</p>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              void openExample(selected.plugin_id!, example.id)
                            }
                            disabled={busy}
                          >
                            {t("Open example")}
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
      {pendingInputs && (
        <RecipeInputResolverDialog
          preparation={pendingInputs}
          onSubmit={(bindings) => continuePreparation(pendingInputs, bindings)}
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
