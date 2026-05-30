/**
 * MetadataEditor — key/value editor for the user-visible part of
 * SignalObj / ImageObj metadata.
 *
 * Replaces the JSON-textarea fallback used by the generic DataSet
 * form: each entry is rendered as a row with type-aware editors
 * (string / number / bool / json), inline Add and per-row Delete.
 * Internal bookkeeping keys (Plotly annotations, creation type,
 * geometry/table results) are filtered out by the Python helper.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  MetadataEntry,
  MetadataValueType,
  DataLabRuntime,
} from "../runtime/runtime";
import { t } from "../i18n/translate";

interface Props {
  runtime: DataLabRuntime;
  oid: string;
  /** Bumped by the parent whenever the underlying object changed. */
  refreshNonce: number;
  /** Called after a successful add/edit/delete so the parent can
   *  refresh the plot / tree. */
  onChanged: () => void;
}

const VALUE_TYPES: MetadataValueType[] = ["string", "number", "bool", "json"];

export function MetadataEditor({
  runtime,
  oid,
  refreshNonce,
  onChanged,
}: Props) {
  const [entries, setEntries] = useState<MetadataEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "Add" form state — kept here so it persists across re-renders.
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<MetadataValueType>("string");
  const [newValue, setNewValue] = useState("");
  // Local re-fetch counter (in addition to the parent's refreshNonce):
  // bumped after every successful mutation so the list re-loads.
  const [localNonce, setLocalNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime
      .listObjectMetadata(oid)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce, localNonce]);

  const refresh = useCallback(() => {
    setLocalNonce((n) => n + 1);
    onChanged();
  }, [onChanged]);

  const handleUpdate = useCallback(
    async (entry: MetadataEntry) => {
      setError(null);
      try {
        await runtime.setObjectMetadataValue(
          oid,
          entry.key,
          entry.value_type,
          entry.value,
        );
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runtime, oid, refresh],
  );

  const handleDelete = useCallback(
    async (key: string) => {
      setError(null);
      try {
        await runtime.deleteObjectMetadataKey(oid, key);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runtime, oid, refresh],
  );

  const handleAdd = useCallback(async () => {
    const key = newKey.trim();
    if (!key) return;
    setError(null);
    try {
      await runtime.setObjectMetadataValue(oid, key, newType, newValue);
      setNewKey("");
      setNewValue("");
      setNewType("string");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runtime, oid, newKey, newType, newValue, refresh]);

  return (
    <section className="metadata-editor" aria-label={t("Metadata")}>
      <h3 className="metadata-editor-title">{t("Metadata")}</h3>
      {error && <div className="metadata-editor-error">{error}</div>}
      {loading ? (
        <div className="metadata-editor-loading">{t("Loading…")}</div>
      ) : entries.length === 0 ? (
        <div className="metadata-editor-empty">{t("No metadata.")}</div>
      ) : (
        <ul className="metadata-editor-list">
          {entries.map((entry) => (
            <MetadataRow
              key={entry.key}
              entry={entry}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}
      <div className="metadata-editor-add">
        <input
          type="text"
          placeholder={t("key")}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          aria-label={t("New metadata key")}
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as MetadataValueType)}
          aria-label={t("New metadata value type")}
        >
          {VALUE_TYPES.map((vt) => (
            <option key={vt} value={vt}>
              {vt}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder={t("value")}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          aria-label={t("New metadata value")}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newKey.trim()}
          className="metadata-editor-add-btn"
        >
          {t("Add")}
        </button>
      </div>
    </section>
  );
}

interface MetadataRowProps {
  entry: MetadataEntry;
  onUpdate: (entry: MetadataEntry) => void | Promise<void>;
  onDelete: (key: string) => void | Promise<void>;
}

function MetadataRow({ entry, onUpdate, onDelete }: MetadataRowProps) {
  // Local draft state — the row stays "dirty" until the user blurs
  // the input or presses Enter, at which point we push to the parent.
  const [draft, setDraft] = useState(entry.value);
  const [draftType, setDraftType] = useState<MetadataValueType>(
    entry.value_type,
  );

  // Resync with prop when the parent reloads.
  useEffect(() => {
    setDraft(entry.value);
    setDraftType(entry.value_type);
  }, [entry.value, entry.value_type]);

  const dirty = draft !== entry.value || draftType !== entry.value_type;

  const commit = useCallback(() => {
    if (!dirty) return;
    onUpdate({ key: entry.key, value_type: draftType, value: draft });
  }, [dirty, draft, draftType, entry.key, onUpdate]);

  return (
    <li className="metadata-editor-row">
      <span className="metadata-editor-key" title={entry.key}>
        {entry.key}
      </span>
      <select
        className="metadata-editor-type"
        value={draftType}
        onChange={(e) => setDraftType(e.target.value as MetadataValueType)}
        onBlur={commit}
        aria-label={t("Type for {key}", { key: entry.key })}
      >
        {VALUE_TYPES.map((vt) => (
          <option key={vt} value={vt}>
            {vt}
          </option>
        ))}
      </select>
      {draftType === "bool" ? (
        <label className="metadata-editor-bool">
          <input
            type="checkbox"
            checked={(draft || "").trim().toLowerCase() === "true"}
            onChange={(e) => {
              const v = e.target.checked ? "true" : "false";
              setDraft(v);
              onUpdate({ key: entry.key, value_type: "bool", value: v });
            }}
            aria-label={t("Value of {key}", { key: entry.key })}
          />
          {draft || "false"}
        </label>
      ) : draftType === "json" ? (
        <textarea
          className="metadata-editor-value"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          aria-label={t("Value of {key}", { key: entry.key })}
        />
      ) : (
        <input
          className="metadata-editor-value"
          type={draftType === "number" ? "text" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          aria-label={t("Value of {key}", { key: entry.key })}
        />
      )}
      <button
        type="button"
        className="metadata-editor-delete"
        onClick={() => onDelete(entry.key)}
        title={t("Delete {key}", { key: entry.key })}
        aria-label={t("Delete {key}", { key: entry.key })}
      >
        ×
      </button>
    </li>
  );
}
