/**
 * ObjectProvenancePanel — provenance of the selected signal or image.
 *
 * Shows the recorded activity that produced the latest recorded state of the
 * object: operation, parameters (read-only), ordered inputs and their status,
 * expanded on demand to their own recorded production, then the analyses
 * recorded on the object. Mirrors the History tab of DataLab Desktop.
 *
 * Three operations are kept apart: consulting reads the ledger only (no array
 * is read or paged in); *Check data* compares the data with their recorded
 * states without computing; *Verify computation* recomputes the recorded
 * activity as a separate candidate. None of them changes the workspace.
 * Results arriving after the selection or the workspace changed are dropped.
 * Every value and title is rendered as text.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProvenanceActivity,
  ProvenanceDescription,
  ProvenanceInput,
  ProvenanceReport,
} from "../runtime/runtime";
import type { RuntimeApi } from "../runtime/RuntimeApi";
import { t } from "../i18n/translate";
import { ProvenanceVerdict } from "./ProvenanceVerdict";

const MAX_TEXT = 120;
const MAX_ITEMS = 8;

/** Bounded text of a parameter value encoded by the Sigima codec: arrays
 *  are shown by type and shape, never by content. */
export function formatParameterValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map(formatParameterValue);
    const suffix = value.length > MAX_ITEMS ? ", …" : "";
    return `[${items.join(", ")}${suffix}] (${value.length})`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("$ndarray" in record) {
      const array = record.$ndarray as { dtype?: string; shape?: number[] };
      const shape = (array.shape ?? []).join("×") || "0";
      return t("array {shape} ({dtype})", {
        shape,
        dtype: array.dtype ?? "?",
      });
    }
    if ("$float" in record) return String(record.$float);
    if ("$complex" in record) {
      const [re, im] = (record.$complex as unknown[]).map(formatParameterValue);
      return `(${re}${im.startsWith("-") ? "" : "+"}${im}j)`;
    }
    if ("$tuple" in record) {
      return `(${(record.$tuple as unknown[]).map(formatParameterValue).join(", ")})`;
    }
    if ("$datetime" in record) return String(record.$datetime);
    if ("$date" in record) return String(record.$date);
    const inner = ("$dict" in record ? record.$dict : record) as Record<
      string,
      unknown
    >;
    const items = Object.entries(inner).map(
      ([key, item]) => `${key}=${formatParameterValue(item)}`,
    );
    const suffix = items.length > MAX_ITEMS ? ", …" : "";
    return `{${items.slice(0, MAX_ITEMS).join(", ")}${suffix}}`;
  }
  const text = String(value);
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function contentMessage(content: string): string {
  switch (content) {
    case "unchecked":
      return t("Data to be checked");
    case "matches":
      return t("The object holds the recorded state");
    case "differs":
      return t(
        "The current content differs from the last recorded state: the recorded production is not attributed to it",
      );
    case "absent":
      return t("The object no longer exists");
    case "unavailable":
      return t("The data of the object are not loaded: they cannot be checked");
    case "unknown":
      return t("The state cannot be checked (no fingerprint)");
    case "unrecorded":
      return t("No state of this object is recorded");
    default:
      return content;
  }
}

function inputMessage(status: string): string {
  switch (status) {
    case "unchecked":
      return t("Data to be checked");
    case "available":
      return t("Recorded state available");
    case "changed":
    case "altered":
      return t("This input has changed since the computation");
    case "missing":
      return t("Original input missing");
    case "unavailable":
      return t("The data of this input are not loaded: they cannot be checked");
    case "unsupported":
      return t("This input cannot be checked");
    case "unknown":
      return t("State at execution time unknown");
    default:
      return status;
  }
}

function outputMessage(status: string): string {
  switch (status) {
    case "unchecked":
      return t("Data to be checked");
    case "available":
      return t("Recorded result available");
    case "altered":
      return t("The result was modified since the computation");
    case "missing":
      return t(
        "Recorded result absent: recomputation possible, comparison with the original result unavailable",
      );
    case "unavailable":
      return t("The data of the result are not loaded: they cannot be checked");
    case "replaced":
      return t("Result replaced by another analysis");
    default:
      return status;
  }
}

function originText(origin: string): string {
  switch (origin) {
    case "ordinary":
      return t("Processing");
    case "recompute_in_place":
      return t("Applied again in place");
    case "history_replay":
      return t("History replay");
    case "legacy_metadata":
      return t("Record of an old workspace");
    default:
      return origin;
  }
}

/** Recorded UTC timestamp as a short local date and time (`YYYY-MM-DD HH:MM`). */
export function shortDate(timestamp: unknown): string {
  if (typeof timestamp !== "string" || !timestamp) return "";
  const moment = new Date(timestamp);
  if (Number.isNaN(moment.getTime())) return timestamp;
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())} ` +
    `${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  );
}

/** Product name of a recorded edition (`desktop`, `web`). */
export function editionName(edition: unknown): string {
  if (edition === "desktop") return "DataLab Desktop";
  if (edition === "web") return "DataLab Web";
  return typeof edition === "string" ? edition : "";
}

function operationTitle(activity: ProvenanceActivity): string {
  if (activity.operation) return activity.operation.id;
  const name = (activity.implementation ?? {}).python_name;
  if (typeof name === "string") return name;
  // A record of an old workspace only names the function it applied.
  const record = activity.legacy?.record;
  const funcName =
    record && typeof record === "object"
      ? (record as Record<string, unknown>).func_name
      : undefined;
  return typeof funcName === "string" && funcName
    ? funcName
    : t("Unknown operation");
}

/** Readable text of an issue found in a record of an old workspace. */
function legacyIssueText(issue: string): string {
  switch (issue) {
    case "missing_ancestry":
      return t("the source objects are not recorded");
    case "unavailable_input":
      return t("a source object is no longer in the workspace");
    case "unsupported_operation":
      return t("the processing is unknown to this application");
    case "pattern_unknown":
      return t("the kind of processing is unknown");
    case "parameters_unreadable":
      return t("the parameters cannot be read");
    case "result_not_identified":
      return t("the result of the analysis is not identified");
    case "output_not_observed":
      return t("the object could not be read");
    case "record_unreadable":
      return t("the record cannot be read");
    case "version_unknown":
      return t("the version that saved the workspace is unknown");
    case "version_mismatch":
      return t("the workspace was saved by another version");
    default:
      return issue;
  }
}

/** Issues and parameters of a record of an old workspace. */
function legacyDetails(activity: ProvenanceActivity): {
  issues: string[];
  parameters: [string, unknown][];
} {
  const legacy = activity.legacy ?? {};
  const issues = Array.isArray(legacy.issues)
    ? legacy.issues.filter(
        (issue): issue is string => typeof issue === "string",
      )
    : [];
  const parameters =
    legacy.parameters && typeof legacy.parameters === "object"
      ? Object.entries(legacy.parameters as Record<string, unknown>)
      : [];
  return { issues, parameters };
}

interface Props {
  runtime: RuntimeApi;
  oid: string;
  refreshNonce: number;
  /** Select the object currently holding an identifier (navigation). */
  onSelectObject?: (oid: string, kind: "signal" | "image") => void;
}

interface Shared {
  runtime: RuntimeApi;
  oid: string;
  onSelectObject?: Props["onSelectObject"];
  /** Verify one activity (the panel shows the report). */
  onVerify: (activityId: string) => void;
  busy: boolean;
  /** The data were checked: steps shown afterwards are checked too. */
  checked: boolean;
}

export function ObjectProvenancePanel({
  runtime,
  oid,
  refreshNonce,
  onSelectObject,
}: Props) {
  const [description, setDescription] = useState<ProvenanceDescription | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ProvenanceReport | null>(null);
  const [checked, setChecked] = useState(false);
  // Bumped whenever the shown object or the workspace changes: results of
  // earlier requests are then dropped.
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setDescription(null);
    setReport(null);
    setError(null);
    setBusy(false);
    setChecked(false);
    runtime
      .describeObjectProvenance(oid)
      .then((value) => {
        if (current === generation.current) setDescription(value);
      })
      .catch((err: unknown) => {
        if (current === generation.current) setError(String(err));
      });
  }, [runtime, oid, refreshNonce]);

  const check = useCallback(async () => {
    const current = generation.current;
    setBusy(true);
    try {
      const value = await runtime.describeObjectProvenance(oid, {
        checkData: true,
      });
      if (current === generation.current) {
        setDescription(value);
        setChecked(true);
      }
    } catch (err) {
      if (current === generation.current) setError(String(err));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [runtime, oid]);

  const verify = useCallback(
    async (activityId: string) => {
      const current = generation.current;
      setBusy(true);
      setReport(null);
      try {
        const value = await runtime.replayActivity(activityId);
        if (current === generation.current) setReport(value);
      } catch (err) {
        if (current === generation.current) setError(String(err));
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [runtime],
  );

  if (error) {
    return (
      <div className="provenance-panel">
        <div className="error">{error}</div>
      </div>
    );
  }
  if (description === null) {
    return (
      <div className="provenance-panel side-panel-info">{t("Loading…")}</div>
    );
  }
  if (!description.available) {
    return (
      <div className="provenance-panel side-panel-info">
        {t(
          "Provenance is not available in this session: processing works as usual.",
        )}
        {description.reason && (
          <div className="provenance-muted">{description.reason}</div>
        )}
      </div>
    );
  }
  const shared: Shared = {
    runtime,
    oid,
    onSelectObject,
    onVerify: (activityId) => void verify(activityId),
    busy,
    checked,
  };
  const anchor = description.anchor;
  const production = description.production ?? null;
  const trail = description.state ? [String(description.state.state_id)] : [];
  return (
    <div className="provenance-panel" data-testid="provenance-panel">
      <div className="provenance-summary" data-testid="provenance-summary">
        {anchor && <div>{contentMessage(anchor.content)}</div>}
        {anchor?.file_status === "altered" && (
          <div>
            {t("The saved data of this object were altered in the file.")}
          </div>
        )}
        {!production && description.state && (
          <div>
            {t("This state was observed, without recorded production.")}
          </div>
        )}
      </div>
      {production && (
        <section className="provenance-section">
          <h4>{t("Production")}</h4>
          <ActivityView activity={production} trail={trail} shared={shared} />
        </section>
      )}
      {(description.analyses ?? []).length > 0 && (
        <details
          className="provenance-section"
          data-testid="provenance-analyses"
        >
          <summary>
            {t("Recorded analyses")} ({description.analyses?.length})
          </summary>
          {(description.analyses ?? []).map((activity) => (
            <ActivityView
              key={activity.activity_id}
              activity={activity}
              trail={trail}
              shared={shared}
            />
          ))}
        </details>
      )}
      {(description.legacy ?? []).length > 0 && (
        <details className="provenance-section">
          <summary>{t("Records of an old workspace")}</summary>
          {(description.legacy ?? []).map((activity) => (
            <ActivityView
              key={activity.activity_id}
              activity={activity}
              trail={trail}
              shared={shared}
            />
          ))}
        </details>
      )}
      {!production &&
        (description.analyses ?? []).length === 0 &&
        (description.legacy ?? []).length === 0 && (
          <div className="side-panel-info">
            {t("No provenance is recorded for this object.")}
          </div>
        )}
      <div className="editable-form-buttons provenance-actions">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy || !description.state}
          title={t(
            "Compare the object and the direct inputs of its production with their recorded states, without computing",
          )}
        >
          {t("Check data")}
        </button>
        {production && (
          <button
            type="button"
            onClick={() => void verify(production.activity_id)}
            disabled={busy}
            title={t(
              "Recompute the recorded activity separately and compare it with the recorded result; the workspace is not changed",
            )}
          >
            {t("Verify computation")}
          </button>
        )}
      </div>
      {report && <ProvenanceVerdict report={report} />}
    </div>
  );
}

function ActivityView({
  activity,
  trail,
  shared,
}: {
  activity: ProvenanceActivity;
  trail: string[];
  shared: Shared;
}) {
  const legacy = legacyDetails(activity);
  const recorded = Object.entries(activity.parameters ?? {});
  const parameters = recorded.length > 0 ? recorded : legacy.parameters;
  const when = shortDate(activity.finished_at);
  return (
    <div className="provenance-activity" data-testid="provenance-activity">
      <div className="provenance-activity-title">
        <strong>{operationTitle(activity)}</strong>{" "}
        <span className="provenance-muted">
          {[originText(activity.origin), editionName(activity.edition), when]
            .filter(Boolean)
            .join(" — ")}
        </span>
      </div>
      {activity.support.reason && (
        <div className="provenance-muted">{activity.support.reason}</div>
      )}
      {parameters.length > 0 && (
        <table className="provenance-parameters">
          <tbody>
            {parameters.map(([name, value]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{formatParameterValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {activity.no_result && <div>{t("Nothing was found (not an error)")}</div>}
      {activity.origin === "legacy_metadata" && (
        <div
          className="provenance-muted"
          data-testid="provenance-legacy-issues"
        >
          {t("Old record: {issues}", {
            issues:
              legacy.issues.length > 0
                ? legacy.issues.map(legacyIssueText).join(", ")
                : t("no issue"),
          })}
        </div>
      )}
      <ol className="provenance-inputs" aria-label={t("Inputs")}>
        {activity.inputs.map((input) => (
          <InputView
            key={`${input.position}:${input.state_id ?? input.object_uuid}`}
            input={input}
            trail={trail}
            shared={shared}
          />
        ))}
      </ol>
      {activity.input_count > activity.inputs.length && (
        <div className="provenance-muted">
          {t("{count} inputs in total", { count: activity.input_count })}
        </div>
      )}
      {activity.outputs.length > 0 && (
        <ul className="provenance-outputs">
          {activity.outputs.map((output, index) => (
            <li key={`${output.role}:${index}`}>
              {output.recorded === "artifact"
                ? `${output.role}: ${output.key}`
                : `${output.role}: ${output.title ?? t("Object no longer exists")}`}
              {" — "}
              {outputMessage(output.status)}
            </li>
          ))}
        </ul>
      )}
      <details className="provenance-details">
        <summary>{t("Details")}</summary>
        <ul>
          {Object.entries(activity.context ?? {})
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => (
              <li key={key}>
                {key}: {formatParameterValue(value)}
              </li>
            ))}
          {activity.environment && (
            <li>
              {t("Software")}:{" "}
              {editionName(activity.environment.edition) || "?"}{" "}
              {String(activity.environment.edition_version ?? "?")}
            </li>
          )}
          {activity.limits.length > 0 && (
            <li>
              {t("Limits")}: {activity.limits.join(", ")}
            </li>
          )}
        </ul>
      </details>
      {activity.origin !== "legacy_metadata" && activity.operation && (
        <button
          type="button"
          className="provenance-link"
          onClick={() => shared.onVerify(activity.activity_id)}
          disabled={shared.busy}
        >
          {t("Verify this step")}
        </button>
      )}
    </div>
  );
}

function InputView({
  input,
  trail,
  shared,
}: {
  input: ProvenanceInput;
  trail: string[];
  shared: Shared;
}) {
  const [expanded, setExpanded] = useState(false);
  const [ancestor, setAncestor] = useState<ProvenanceDescription | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { runtime, oid, onSelectObject, checked } = shared;
  // The trail is compared by value: parents re-render with new arrays.
  const trailKey = trail.join("\n");

  useEffect(() => {
    if (!expanded || !input.state_id) return;
    let cancelled = false;
    runtime
      .describeObjectProvenance(oid, {
        stateId: input.state_id,
        trail: trailKey ? trailKey.split("\n") : [],
        checkData: checked,
      })
      .then((value) => {
        if (!cancelled) setAncestor(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, runtime, oid, input.state_id, trailKey, checked]);

  const name = input.title ?? t("Original input missing");
  const kind = input.object_kind;
  return (
    <li data-testid="provenance-input">
      <span>
        {input.role}: {name}
      </span>
      {" — "}
      <span className="provenance-muted">{inputMessage(input.data)}</span>
      {input.cycle && (
        <span className="provenance-muted">
          {" "}
          ({t("already shown above (cycle)")})
        </span>
      )}{" "}
      {input.has_ancestors && (
        <button
          type="button"
          className="provenance-link"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {/* The triangle says that the button shows or hides a part of the view */}
          {expanded
            ? `▾ ${t("Hide recorded step")}`
            : `▸ ${t("Show recorded step")}`}
        </button>
      )}
      {input.id && input.object_present && onSelectObject && (
        <button
          type="button"
          className="provenance-link"
          title={t(
            "Show this object in the signal or image panel (it may have changed since the computation)",
          )}
          onClick={() =>
            onSelectObject(
              input.id as string,
              kind === "image" ? "image" : "signal",
            )
          }
        >
          {t("Go to object")}
        </button>
      )}
      {expanded && failed && <div className="error">{failed}</div>}
      {expanded && ancestor?.production && (
        <ActivityView
          activity={ancestor.production}
          trail={[...trail, input.state_id as string]}
          shared={shared}
        />
      )}
      {expanded && ancestor && !ancestor.production && (
        <div className="provenance-muted">
          {t("Observed state, without recorded production")}
        </div>
      )}
    </li>
  );
}
