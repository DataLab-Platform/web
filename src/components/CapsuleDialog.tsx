/**
 * Capsule dialog: export, inspect, replay, compare revisions and review.
 *
 * Three results are shown apart and never mixed:
 *
 * - **Integrity** of a capsule: computed from its files (manifest, workspace,
 *   stored states); nothing is recomputed.
 * - **Supplied documents**: verification reports and reviews given with the
 *   capsule, checked against it; their verdicts are what their authors claim.
 * - **Local replay**: an activity of the open workspace recomputed in this
 *   browser and compared with its stored result.
 *
 * All the logic lives in DataLab-Capsule, called through the runtime.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { t } from "../i18n/translate";
import type {
  CapsuleDiff,
  CapsuleInspection,
  CapsuleReview,
  CapsuleReviewVerdict,
  ProvenanceLedgerInfo,
  ProvenanceReport,
} from "../runtime/runtime";
import type { RuntimeApi } from "../runtime/RuntimeApi";
import {
  listRevisions,
  recordRevision,
  type CapsuleRevision,
} from "../storage/capsuleRevisions";
import {
  loadRegistrySettings,
  RegistryClient,
  saveRegistrySettings,
  type RegistryRevision,
  type RegistrySettings,
} from "../storage/capsuleRegistry";
import {
  acceptFromExtensions,
  saveBytesToFile,
  type SaveFileResult,
} from "../utils/saveFile";

type Tab = "export" | "inspect" | "replay" | "revisions" | "registry";

interface CapsuleDialogProps {
  runtime: RuntimeApi;
  onClose: () => void;
  /** Called after a capsule was opened as the current workspace. */
  onOpened: (filename: string) => Promise<void>;
  onSaved: (result: SaveFileResult) => void;
}

const capsuleAccept = () =>
  acceptFromExtensions(t("DataLab capsules"), ["dlcapsule"], "application/zip");
const jsonAccept = () =>
  acceptFromExtensions(t("JSON files"), ["json"], "application/json");

/** Save a JSON document (report or review) as a file. */
async function saveJson(
  value: unknown,
  filename: string,
): Promise<SaveFileResult> {
  return saveBytesToFile(
    new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
    filename,
    [jsonAccept()],
    "application/json",
  );
}

function shortId(id: string | null | undefined): string {
  if (!id) return "";
  const raw = id.replace(/^#(activity|state)-/, "").replace(/^sha256:/, "");
  return raw.slice(0, 12);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/** Largest attachment accepted by DataLab-Capsule (checked before reading). */
const MAX_ATTACHMENT_BYTES = 16 * 1024 ** 2;

/** Attachment name allowed by the capsule profile, unique among ``taken``. */
function attachmentName(filename: string, taken: Set<string>): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  const base = (/^[A-Za-z0-9]/.test(safe) ? safe : `file${safe}`).slice(0, 96);
  let name = base;
  for (let index = 2; taken.has(name); index += 1) {
    name = `${index}-${base}`;
  }
  return name;
}

function formatSize(bytes: number): string {
  return bytes < 1024
    ? t("{size} B", { size: bytes })
    : t("{size} KiB", { size: (bytes / 1024).toFixed(1) });
}

async function revisionOf(inspection: CapsuleInspection) {
  const summary = inspection.summary;
  if (!summary || !inspection.manifest) return;
  await recordRevision({
    fingerprint: summary.fingerprint,
    name: summary.name,
    revisionOf: summary.revision_of,
    datePublished: summary.date_published,
    source: "inspected",
    manifest: inspection.manifest,
  });
}

export function CapsuleDialog(props: CapsuleDialogProps) {
  const { runtime, onClose, onOpened, onSaved } = props;
  const [tab, setTab] = useState<Tab>("export");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ProvenanceLedgerInfo | null>(null);
  const [revisions, setRevisions] = useState<CapsuleRevision[]>([]);
  const [registry, setRegistry] =
    useState<RegistrySettings>(loadRegistrySettings);

  const refreshInfo = useCallback(async () => {
    setInfo(await runtime.getProvenanceLedger());
    setRevisions(await listRevisions());
  }, [runtime]);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, onClose]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const tabs: [Tab, string][] = [
    ["export", t("Export")],
    ["inspect", t("Inspect")],
    ["replay", t("Local replay")],
    ["revisions", t("Revisions")],
    ["registry", t("Registry")],
  ];

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card capsule-card" data-testid="capsule-dialog">
        <h2>{t("Workspace capsule")}</h2>
        <div className="capsule-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert" data-testid="capsule-error">
            {error}
          </p>
        )}
        {info && !info.available ? (
          <p>{t("Capsules need DataLab-Capsule, which is not installed.")}</p>
        ) : (
          <>
            {tab === "export" && (
              <ExportTab
                runtime={runtime}
                info={info}
                busy={busy}
                run={run}
                onSaved={async (result) => {
                  onSaved(result);
                  await refreshInfo();
                }}
              />
            )}
            {tab === "inspect" && (
              <InspectTab
                runtime={runtime}
                busy={busy}
                run={run}
                registry={registry}
                onInspected={refreshInfo}
                onOpened={async (filename) => {
                  await onOpened(filename);
                  await refreshInfo();
                }}
                onSaved={onSaved}
              />
            )}
            {tab === "replay" && (
              <ReplayTab runtime={runtime} info={info} busy={busy} run={run} />
            )}
            {tab === "revisions" && (
              <RevisionsTab
                runtime={runtime}
                revisions={revisions}
                busy={busy}
                run={run}
              />
            )}
            {tab === "registry" && (
              <RegistryTab
                runtime={runtime}
                busy={busy}
                run={run}
                settings={registry}
                onSettings={(settings) => {
                  saveRegistrySettings(settings);
                  setRegistry(loadRegistrySettings());
                }}
                onRetrieved={refreshInfo}
                onSaved={onSaved}
              />
            )}
          </>
        )}
        <div className="actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  runtime: RuntimeApi;
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
}

function ExportTab(
  props: TabProps & {
    info: ProvenanceLedgerInfo | null;
    onSaved: (result: SaveFileResult) => Promise<void>;
  },
) {
  const { runtime, info, busy, run, onSaved } = props;
  const origin = info?.capsule_origin ?? null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [asRevision, setAsRevision] = useState(true);
  const [referenced, setReferenced] = useState(false);
  const [workspaceRef, setWorkspaceRef] = useState("");
  const [attachments, setAttachments] = useState<
    { name: string; file: File }[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const parentOnly = (origin?.attachments ?? []).filter(
    (name) => !attachments.some((a) => a.name === name),
  );

  const addAttachments = async () => {
    const files = await pickFiles();
    const taken = new Set(attachments.map((a) => a.name));
    const added: { name: string; file: File }[] = [];
    const tooLarge: string[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        tooLarge.push(file.name);
        continue;
      }
      const name = attachmentName(file.name, taken);
      taken.add(name);
      added.push({ name, file });
    }
    setAttachments([...attachments, ...added]);
    setAttachmentError(
      tooLarge.length
        ? t("Attachments are limited to 16 MiB: {files}", {
            files: tooLarge.join(", "),
          })
        : null,
    );
  };

  const exportCapsule = () =>
    run(async () => {
      const options = {
        description: description || null,
        revisionOf: origin && asRevision ? origin.fingerprint : null,
        // Read on each export: worker mode moves (detaches) the bytes.
        attachments: await Promise.all(
          attachments.map(async ({ name: attachment, file }) => ({
            name: attachment,
            data: new Uint8Array(await file.arrayBuffer()),
            media_type: file.type || "application/octet-stream",
          })),
        ),
      };
      const filename = `${(name || "workspace").replace(/[^\w.-]+/g, "_")}.dlcapsule`;
      let capsule: Uint8Array;
      if (referenced) {
        const exported = await runtime.exportReferencedCapsule(
          workspaceRef,
          name || null,
          options,
        );
        capsule = exported.capsule;
        // The workspace is saved separately, to be published at the IRI.
        const leaf = workspaceRef.split("/").pop() || "workspace.h5";
        onSaved(
          await saveBytesToFile(
            exported.workspace,
            leaf,
            [
              acceptFromExtensions(
                t("HDF5 files"),
                ["h5"],
                "application/x-hdf",
              ),
            ],
            "application/x-hdf",
          ),
        );
      } else {
        capsule = await runtime.exportWorkspaceCapsule(name || null, options);
      }
      // Worker mode transfers (detaches) argument buffers: inspect a copy,
      // the capsule bytes are saved below.
      const inspection = await runtime.inspectWorkspaceCapsule(capsule.slice());
      if (inspection.summary && inspection.manifest) {
        await recordRevision({
          fingerprint: inspection.summary.fingerprint,
          name: inspection.summary.name,
          revisionOf: inspection.summary.revision_of,
          datePublished: inspection.summary.date_published,
          source: "exported",
          manifest: inspection.manifest,
        });
      }
      await onSaved(
        await saveBytesToFile(
          capsule,
          filename,
          [capsuleAccept()],
          "application/zip",
        ),
      );
    });

  return (
    <div className="capsule-tab" data-testid="capsule-export">
      <p>
        {t(
          "A capsule holds the workspace and the provenance of its processing, so that someone else can check and replay it.",
        )}
      </p>
      <label className="row">
        {t("Name")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="capsule-name"
        />
      </label>
      <label className="row">
        {t("Description")}
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {origin && (
        <label className="row">
          <input
            type="checkbox"
            checked={asRevision}
            onChange={(e) => setAsRevision(e.target.checked)}
            data-testid="capsule-as-revision"
          />
          {t("Revision of {name} ({fingerprint})", {
            name: origin.name,
            fingerprint: shortId(origin.fingerprint),
          })}
        </label>
      )}
      {origin && asRevision && parentOnly.length > 0 && (
        <p className="capsule-note" data-testid="capsule-parent-attachments">
          {t(
            "The parent revision has attachments that are not copied: {names}. Select them again below if they still apply.",
            { names: parentOnly.join(", ") },
          )}
        </p>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={referenced}
          onChange={(e) => setReferenced(e.target.checked)}
          data-testid="capsule-referenced"
        />
        {t("Reference the workspace instead of including it")}
      </label>
      {referenced && (
        <label className="row">
          {t("Workspace address (absolute IRI)")}
          <input
            value={workspaceRef}
            onChange={(e) => setWorkspaceRef(e.target.value)}
            placeholder="https://"
            data-testid="capsule-workspace-ref"
          />
        </label>
      )}
      <section data-testid="capsule-attachments-export">
        <h3>{t("Attachments")}</h3>
        <p>
          {t(
            "Light files (protocol, notes, small tables) declared in the capsule with their size and fingerprint. They are never opened or executed.",
          )}
        </p>
        {attachments.length > 0 && (
          <ul>
            {attachments.map(({ name: attachment, file }) => (
              <li key={attachment} data-testid="capsule-attachment-selected">
                <code>{attachment}</code> ({formatSize(file.size)}){" "}
                <button
                  type="button"
                  onClick={() =>
                    setAttachments(
                      attachments.filter((a) => a.name !== attachment),
                    )
                  }
                  disabled={busy}
                >
                  {t("Remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {attachmentError && (
          <p className="error" role="alert">
            {attachmentError}
          </p>
        )}
        <button
          type="button"
          onClick={addAttachments}
          disabled={busy}
          data-testid="capsule-add-attachment"
        >
          {t("Add attachments…")}
        </button>
      </section>
      <div className="actions">
        <button
          type="button"
          onClick={exportCapsule}
          disabled={busy || (referenced && !workspaceRef)}
          data-testid="capsule-export-button"
        >
          {t("Export capsule…")}
        </button>
      </div>
    </div>
  );
}

function InspectTab(
  props: TabProps & {
    registry: RegistrySettings;
    onInspected: () => Promise<void>;
    onOpened: (filename: string) => Promise<void>;
    onSaved: (result: SaveFileResult) => void;
  },
) {
  const { runtime, busy, run, registry, onInspected, onOpened, onSaved } =
    props;
  const [published, setPublished] = useState<string | null>(null);
  const [capsule, setCapsule] = useState<File | null>(null);
  const [workspace, setWorkspace] = useState<File | null>(null);
  const [reports, setReports] = useState<{ name: string; text: string }[]>([]);
  const [reviews, setReviews] = useState<{ name: string; text: string }[]>([]);
  const [inspection, setInspection] = useState<CapsuleInspection | null>(null);

  const inspect = useCallback(
    (
      file: File,
      supplied: {
        workspace: File | null;
        reports: { text: string }[];
        reviews: { text: string }[];
      },
    ) =>
      run(async () => {
        const result = await runtime.inspectWorkspaceCapsule(file, {
          workspace: supplied.workspace,
          reports: supplied.reports.map((r) => r.text),
          reviews: supplied.reviews.map((r) => r.text),
        });
        setInspection(result);
        await revisionOf(result);
        await onInspected();
      }),
    [run, runtime, onInspected],
  );

  const choose = async () => {
    const file = await pickFile(".dlcapsule,.zip");
    if (!file) return;
    setCapsule(file);
    setWorkspace(null);
    setReports([]);
    setReviews([]);
    await inspect(file, { workspace: null, reports: [], reviews: [] });
  };

  const addDocument = async (kind: "report" | "review") => {
    const file = await pickFile(".json");
    if (!file || !capsule) return;
    const entry = { name: file.name, text: await file.text() };
    const nextReports = kind === "report" ? [...reports, entry] : reports;
    const nextReviews = kind === "review" ? [...reviews, entry] : reviews;
    setReports(nextReports);
    setReviews(nextReviews);
    await inspect(capsule, {
      workspace,
      reports: nextReports,
      reviews: nextReviews,
    });
  };

  const chooseWorkspace = async () => {
    const file = await pickFile(".h5,.hdf5");
    if (!file || !capsule) return;
    setWorkspace(file);
    await inspect(capsule, { workspace: file, reports, reviews });
  };

  const open = () =>
    run(async () => {
      if (!capsule) return;
      await runtime.openWorkspaceCapsule(
        capsule.name,
        capsule,
        true,
        workspace,
      );
      await onOpened(capsule.name);
    });

  const download = (attachment: { name: string; media_type: string }) =>
    run(async () => {
      if (!capsule) return;
      const bytes = await runtime.getCapsuleAttachment(
        capsule,
        attachment.name,
      );
      onSaved(
        await saveBytesToFile(
          bytes,
          attachment.name,
          undefined,
          attachment.media_type,
        ),
      );
    });

  const summary = inspection?.summary ?? null;
  const referenced = summary?.workspace.referenced ?? false;

  // Publish the manifest, its attachments and the valid supplied reviews.
  const publish = () =>
    run(async () => {
      if (!capsule || !inspection?.manifest || !summary) return;
      setPublished(null);
      const client = new RegistryClient(registry.address, registry.token);
      const { fingerprint } = await client.publishManifest(
        JSON.stringify(inspection.manifest),
      );
      for (const attachment of summary.attachments) {
        await client.uploadAttachment(
          fingerprint,
          attachment.name,
          await runtime.getCapsuleAttachment(capsule, attachment.name),
        );
      }
      const valid = inspection.documents?.reviews ?? [];
      let count = 0;
      for (const [index, review] of reviews.entries()) {
        if (valid[index]?.status === "valid") {
          await client.publishReview(review.text);
          count += 1;
        }
      }
      setPublished(
        t(
          "Published {fingerprint} with {attachments} attachments and {reviews} reviews",
          {
            fingerprint: shortId(fingerprint),
            attachments: summary.attachments.length,
            reviews: count,
          },
        ),
      );
    });

  return (
    <div className="capsule-tab" data-testid="capsule-inspect">
      <div className="actions">
        <button
          type="button"
          onClick={choose}
          disabled={busy}
          data-testid="capsule-choose"
        >
          {t("Choose a capsule…")}
        </button>
        {capsule && referenced && (
          <button
            type="button"
            onClick={chooseWorkspace}
            disabled={busy}
            data-testid="capsule-choose-workspace"
          >
            {t("Select the referenced workspace…")}
          </button>
        )}
        {capsule && (
          <>
            <button
              type="button"
              onClick={() => addDocument("report")}
              disabled={busy || !summary}
              data-testid="capsule-add-report"
            >
              {t("Add a verification report…")}
            </button>
            <button
              type="button"
              onClick={() => addDocument("review")}
              disabled={busy || !summary}
              data-testid="capsule-add-review"
            >
              {t("Add a review…")}
            </button>
          </>
        )}
      </div>
      {inspection && (
        <>
          {summary && <CapsuleSummaryView summary={summary} />}
          {summary && summary.attachments.length > 0 && (
            <AttachmentsSection
              attachments={summary.attachments}
              busy={busy || !inspection.integrity.valid}
              onDownload={download}
            />
          )}
          <IntegritySection inspection={inspection} />
          <DocumentsSection
            inspection={inspection}
            reports={reports}
            reviews={reviews}
          />
          {summary && inspection.manifest && (
            <ReviewWriter
              runtime={runtime}
              manifest={inspection.manifest}
              registry={registry}
              busy={busy}
              run={run}
              onSaved={onSaved}
            />
          )}
          {published && <p data-testid="capsule-published">{published}</p>}
          <div className="actions">
            {registry.address && (
              <button
                type="button"
                onClick={publish}
                disabled={busy || !inspection.integrity.valid}
                data-testid="capsule-publish"
              >
                {t("Publish to the registry")}
              </button>
            )}
            <button
              type="button"
              onClick={open}
              disabled={
                busy ||
                !inspection.integrity.valid ||
                (referenced && workspace === null)
              }
              data-testid="capsule-open"
            >
              {t("Open as workspace")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CapsuleSummaryView(props: {
  summary: NonNullable<CapsuleInspection["summary"]>;
}) {
  const { summary } = props;
  return (
    <section data-testid="capsule-summary">
      <h3>{summary.name}</h3>
      <p>{summary.description}</p>
      <dl className="capsule-facts">
        <dt>{t("Fingerprint")}</dt>
        <dd>
          <code>{summary.fingerprint}</code>
        </dd>
        <dt>{t("Revision of")}</dt>
        <dd data-testid="capsule-revision-of">
          {summary.revision_of ? <code>{summary.revision_of}</code> : t("none")}
        </dd>
        <dt>{t("Workspace")}</dt>
        <dd>
          {summary.workspace.referenced
            ? t("referenced at {address}", { address: summary.workspace.id })
            : t("included")}
        </dd>
        <dt>{t("Licence")}</dt>
        <dd>{summary.license}</dd>
      </dl>
      <table className="capsule-table" data-testid="capsule-activities">
        <thead>
          <tr>
            <th>{t("Activity")}</th>
            <th>{t("Operation")}</th>
            <th>{t("Origin")}</th>
            <th>{t("Replay")}</th>
          </tr>
        </thead>
        <tbody>
          {summary.activities.map((activity) => (
            <tr key={activity.id}>
              <td>
                <code>{shortId(activity.id)}</code>
              </td>
              <td>{activity.name}</td>
              <td>{activity.origin}</td>
              <td>
                {activity.replayable ? t("replayable") : t("not replayable")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AttachmentsSection(props: {
  attachments: NonNullable<CapsuleInspection["summary"]>["attachments"];
  busy: boolean;
  onDownload: (attachment: { name: string; media_type: string }) => void;
}) {
  const { attachments, busy, onDownload } = props;
  return (
    <section data-testid="capsule-attachments">
      <h3>{t("Attachments")}</h3>
      <p>
        {t(
          "Files added by the author, outside the processing. They are checked against the manifest and saved only when you ask; they are never opened.",
        )}
      </p>
      <table className="capsule-table">
        <thead>
          <tr>
            <th>{t("Name")}</th>
            <th>{t("Type")}</th>
            <th>{t("Size")}</th>
            <th>{t("SHA-256")}</th>
            <th>{t("Description")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {attachments.map((attachment) => (
            <tr key={attachment.name} data-testid="capsule-attachment-row">
              <td>
                <code>{attachment.name}</code>
              </td>
              <td>{attachment.media_type}</td>
              <td>{formatSize(Number(attachment.size))}</td>
              <td>
                <code title={attachment.sha256}>
                  {attachment.sha256.slice(0, 12)}
                </code>
              </td>
              <td>{attachment.description ?? ""}</td>
              <td>
                <button
                  type="button"
                  onClick={() => onDownload(attachment)}
                  disabled={busy}
                  data-testid="capsule-attachment-save"
                >
                  {t("Save…")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function IntegritySection(props: { inspection: CapsuleInspection }) {
  const { integrity } = props.inspection;
  const workspaceLabel: Record<string, string> = {
    verified: t("checked"),
    integrity_only: t("SHA-256 and size checked; stored states not read"),
    not_available: t("not supplied: stored states not checked"),
  };
  return (
    <section data-testid="capsule-integrity">
      <h3>{t("Integrity")}</h3>
      <p className="capsule-note">
        {t("Computed from the files; nothing is recomputed.")}
      </p>
      <p data-testid="capsule-integrity-status">
        {integrity.valid ? t("Intact") : t("Not intact")}
      </p>
      {integrity.workspace && (
        <p>
          {t("Workspace: {status}", {
            status: workspaceLabel[integrity.workspace] ?? integrity.workspace,
          })}
        </p>
      )}
      {integrity.states_located !== null && (
        <p>
          {t("Stored states checked: {count}, altered: {altered}", {
            count: integrity.states_located,
            altered: integrity.states_altered.length,
          })}
        </p>
      )}
      {integrity.problems.length > 0 && (
        <ul className="error">
          {integrity.problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DocumentsSection(props: {
  inspection: CapsuleInspection;
  reports: { name: string }[];
  reviews: { name: string }[];
}) {
  const { inspection, reports, reviews } = props;
  const documents = inspection.documents;
  if (!documents || (reports.length === 0 && reviews.length === 0)) {
    return null;
  }
  return (
    <section data-testid="capsule-documents">
      <h3>{t("Supplied documents")}</h3>
      <p className="capsule-note">
        {t(
          "Checked against this capsule. Their verdicts are what their authors claim; they were not recomputed here.",
        )}
      </p>
      <ul>
        {documents.reports.map((entry, index) => (
          <li key={`report-${index}`} data-testid="capsule-report-status">
            {t(
              "Report {name}: activity {activity}, claimed verdict {verdict}, {status}",
              {
                name: reports[index]?.name ?? "",
                activity: shortId(entry.activity_id),
                verdict: entry.verdict ?? "",
                status:
                  entry.status === "valid" ? t("consistent") : entry.status,
              },
            )}
          </li>
        ))}
        {documents.reviews.map((entry, index) => (
          <li key={`review-${index}`} data-testid="capsule-review-status">
            {t("Review {name}: {status}", {
              name: reviews[index]?.name ?? "",
              status: entry.status === "valid" ? t("consistent") : entry.status,
            })}
          </li>
        ))}
        {documents.unreadable.map((entry, index) => (
          <li key={`unreadable-${index}`}>
            {t("Unreadable document: {status}", { status: entry.status })}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewWriter(
  props: TabProps & {
    manifest: Record<string, unknown>;
    registry: RegistrySettings;
    onSaved: (result: SaveFileResult) => void;
  },
) {
  const { runtime, manifest, registry, busy, run, onSaved } = props;
  const [reviewer, setReviewer] = useState("");
  const [statement, setStatement] = useState("");
  const [verdict, setVerdict] = useState<CapsuleReviewVerdict | "">("");
  const [cited, setCited] = useState<ProvenanceReport[]>([]);
  const [published, setPublished] = useState<string | null>(null);

  const addReport = async () => {
    const file = await pickFile(".json");
    if (!file) return;
    try {
      setCited([...cited, JSON.parse(await file.text()) as ProvenanceReport]);
    } catch {
      // Unreadable files are reported by the inspection, not cited here.
    }
  };

  const write = () =>
    run(async () => {
      const review: CapsuleReview = await runtime.createCapsuleReview(
        manifest,
        reviewer,
        statement,
        verdict || null,
        cited,
      );
      onSaved(
        await saveJson(
          review,
          `review-${shortId(review.review_fingerprint)}.json`,
        ),
      );
    });

  const publishReview = () =>
    run(async () => {
      setPublished(null);
      const review: CapsuleReview = await runtime.createCapsuleReview(
        manifest,
        reviewer,
        statement,
        verdict || null,
        cited,
      );
      const result = await new RegistryClient(
        registry.address,
        registry.token,
      ).publishReview(JSON.stringify(review));
      setPublished(
        t("Review {fingerprint} published", {
          fingerprint: shortId(result.fingerprint),
        }),
      );
    });

  return (
    <section data-testid="capsule-review-writer">
      <h3>{t("Write a review")}</h3>
      <p className="capsule-note">
        {t(
          "A review is a separate file about this revision; the capsule is not changed.",
        )}
      </p>
      <label className="row">
        {t("Reviewer")}
        <input
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          data-testid="capsule-reviewer"
        />
      </label>
      <label className="row">
        {t("Statement")}
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          data-testid="capsule-statement"
        />
      </label>
      <label className="row">
        {t("Verdict")}
        <select
          value={verdict}
          onChange={(e) => setVerdict(e.target.value as CapsuleReviewVerdict)}
          data-testid="capsule-verdict"
        >
          <option value="">{t("No verdict")}</option>
          <option value="endorsed">{t("endorsed")}</option>
          <option value="disputed">{t("disputed")}</option>
          <option value="comment">{t("comment")}</option>
        </select>
      </label>
      <p>
        {t("Cited reports: {count}", { count: cited.length })}{" "}
        <button
          type="button"
          onClick={addReport}
          disabled={busy}
          data-testid="capsule-cite-report"
        >
          {t("Cite a report…")}
        </button>
      </p>
      <div className="actions">
        <button
          type="button"
          onClick={write}
          disabled={busy || !reviewer || !statement}
          data-testid="capsule-write-review"
        >
          {t("Save the review…")}
        </button>
        {registry.address && (
          <button
            type="button"
            onClick={publishReview}
            disabled={busy || !reviewer || !statement}
            data-testid="capsule-publish-review"
          >
            {t("Publish the review")}
          </button>
        )}
      </div>
      {published && <p data-testid="capsule-review-published">{published}</p>}
    </section>
  );
}

function ReplayTab(props: TabProps & { info: ProvenanceLedgerInfo | null }) {
  const { runtime, info, busy, run } = props;
  const [reports, setReports] = useState<Record<string, ProvenanceReport>>({});
  const activities = useMemo(() => info?.ledger?.activities ?? [], [info]) as {
    activity_id: string;
    call: { operation: { id: string } | null };
  }[];

  const replay = (activityId: string) =>
    run(async () => {
      const report = await runtime.replayActivity(activityId);
      setReports((current) => ({ ...current, [activityId]: report }));
    });

  const save = async (report: ProvenanceReport) => {
    await saveJson(report, `report-${shortId(report.activity_id)}.json`);
  };

  return (
    <div className="capsule-tab" data-testid="capsule-replay">
      <p className="capsule-note">
        {t(
          "Recomputes an activity of the open workspace in this browser and compares it with its stored result. The workspace is not changed.",
        )}
      </p>
      {activities.length === 0 ? (
        <p>{t("The open workspace has no recorded activity.")}</p>
      ) : (
        <table className="capsule-table">
          <thead>
            <tr>
              <th>{t("Activity")}</th>
              <th>{t("Operation")}</th>
              <th>{t("Local result")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => {
              const report = reports[activity.activity_id];
              return (
                <tr key={activity.activity_id} data-testid="capsule-replay-row">
                  <td>
                    <code>{shortId(activity.activity_id)}</code>
                  </td>
                  <td>{activity.call.operation?.id ?? t("not qualified")}</td>
                  <td data-testid="capsule-replay-verdict">
                    {report ? `${report.verdict} (${report.eligibility})` : ""}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => replay(activity.activity_id)}
                      disabled={busy}
                      data-testid="capsule-replay-button"
                    >
                      {t("Replay")}
                    </button>
                    {report && (
                      <button
                        type="button"
                        onClick={() => save(report)}
                        disabled={busy}
                        data-testid="capsule-save-report"
                      >
                        {t("Save report…")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RevisionsTab(props: TabProps & { revisions: CapsuleRevision[] }) {
  const { runtime, revisions, busy, run } = props;
  const [older, setOlder] = useState("");
  const [newer, setNewer] = useState("");
  const [diff, setDiff] = useState<CapsuleDiff | null>(null);

  const compare = () =>
    run(async () => {
      const a = revisions.find((r) => r.fingerprint === older);
      const b = revisions.find((r) => r.fingerprint === newer);
      if (!a || !b) return;
      setDiff(await runtime.diffCapsuleManifests(a.manifest, b.manifest));
    });

  const label = (r: CapsuleRevision) => `${r.name} (${shortId(r.fingerprint)})`;

  return (
    <div className="capsule-tab" data-testid="capsule-revisions">
      <p className="capsule-note">
        {t(
          "Revisions exported or inspected in this browser. A revision names its parent by fingerprint.",
        )}
      </p>
      <table className="capsule-table" data-testid="capsule-revision-list">
        <thead>
          <tr>
            <th>{t("Name")}</th>
            <th>{t("Fingerprint")}</th>
            <th>{t("Parent")}</th>
            <th>{t("Source")}</th>
          </tr>
        </thead>
        <tbody>
          {revisions.map((r) => (
            <tr key={r.fingerprint}>
              <td>{r.name}</td>
              <td>
                <code>{shortId(r.fingerprint)}</code>
              </td>
              <td>
                <code>{shortId(r.revisionOf)}</code>
              </td>
              <td>
                {r.source === "exported"
                  ? t("exported")
                  : r.source === "registry"
                    ? t("from the registry")
                    : t("inspected")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <select
          value={older}
          onChange={(e) => setOlder(e.target.value)}
          data-testid="capsule-diff-old"
        >
          <option value="">{t("Older revision")}</option>
          {revisions.map((r) => (
            <option key={r.fingerprint} value={r.fingerprint}>
              {label(r)}
            </option>
          ))}
        </select>
        <select
          value={newer}
          onChange={(e) => setNewer(e.target.value)}
          data-testid="capsule-diff-new"
        >
          <option value="">{t("Newer revision")}</option>
          {revisions.map((r) => (
            <option key={r.fingerprint} value={r.fingerprint}>
              {label(r)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={compare}
          disabled={busy || !older || !newer}
          data-testid="capsule-compare"
        >
          {t("Compare")}
        </button>
      </div>
      {diff && <DiffView diff={diff} />}
    </div>
  );
}

function DiffView(props: { diff: CapsuleDiff }) {
  const { diff } = props;
  const groups: [
    keyof CapsuleDiff &
      (
        | "scientific"
        | "presentation"
        | "storage"
        | "environment"
        | "attachments"
      ),
    string,
  ][] = [
    ["scientific", t("Scientific changes")],
    ["presentation", t("Presentation changes")],
    ["storage", t("Storage and integrity")],
    ["environment", t("Environment changes")],
    ["attachments", t("Attachments")],
  ];
  const conclusions: Record<CapsuleDiff["scientific_conclusion"], string> = {
    differences: t("Scientific changes were found."),
    none: t("No scientific change, and the same workspace file."),
    none_detected: t(
      "No change in the recorded activities and states. The workspace files differ: content outside the recorded provenance is not compared, so equality is not established.",
    ),
  };
  return (
    <section data-testid="capsule-diff">
      {diff.revision_of_old && (
        <p>{t("The newer revision names the older one as its parent.")}</p>
      )}
      {diff.identical ? (
        <p>{t("The two revisions are identical.")}</p>
      ) : (
        <>
          <p data-testid="capsule-diff-conclusion">
            {conclusions[diff.scientific_conclusion]}
          </p>
          {groups.map(([key, title]) => (
            <div key={key} data-testid={`capsule-diff-${key}`}>
              <h4>
                {title} ({diff[key].length})
              </h4>
              <ul>
                {diff[key].map((change, index) => (
                  <li key={index}>
                    {change.change} {change.item}{" "}
                    <code>
                      {change.item === "attachment"
                        ? change.id
                        : shortId(change.id)}
                    </code>
                    {change.field ? ` ${change.field}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

interface RetrievedRevision {
  fingerprint: string;
  summary: NonNullable<CapsuleInspection["summary"]>;
  reviews: { review: CapsuleReview | null; status: string }[];
  stored: Set<string>;
}

function RegistryTab(
  props: TabProps & {
    settings: RegistrySettings;
    onSettings: (settings: RegistrySettings) => void;
    onRetrieved: () => Promise<void>;
    onSaved: (result: SaveFileResult) => void;
  },
) {
  const { runtime, busy, run, settings, onSettings, onRetrieved, onSaved } =
    props;
  const [address, setAddress] = useState(settings.address);
  const [token, setToken] = useState(settings.token);
  const [status, setStatus] = useState<string | null>(null);
  const [list, setList] = useState<RegistryRevision[] | null>(null);
  const [retrieved, setRetrieved] = useState<RetrievedRevision | null>(null);

  const client = () => new RegistryClient(settings.address, settings.token);

  const save = () =>
    run(async () => {
      onSettings({ address, token });
      setStatus(null);
      setList(null);
      setRetrieved(null);
    });

  const refresh = () =>
    run(async () => {
      const registry = client();
      const info = await registry.status();
      setStatus(
        t("Connected to {registry} {version}", {
          registry: info.registry,
          version: info.version,
        }),
      );
      setList(await registry.listRevisions());
    });

  const retrieve = (revision: RegistryRevision) =>
    run(async () => {
      const registry = client();
      const checked = await runtime.checkRegistryRevision(
        await registry.getManifestText(revision.fingerprint),
        revision.fingerprint,
        await registry.listReviewTexts(revision.fingerprint),
      );
      await recordRevision({
        fingerprint: checked.summary.fingerprint,
        name: checked.summary.name,
        revisionOf: checked.summary.revision_of,
        datePublished: checked.summary.date_published,
        source: "registry",
        manifest: checked.manifest,
      });
      setRetrieved({
        fingerprint: revision.fingerprint,
        summary: checked.summary,
        reviews: checked.reviews,
        stored: new Set(
          revision.attachments.filter((a) => a.stored).map((a) => a.name),
        ),
      });
      await onRetrieved();
    });

  const saveAttachment = (attachment: { name: string; media_type: string }) =>
    run(async () => {
      if (!retrieved) return;
      const declared = retrieved.summary.attachments.find(
        (a) => a.name === attachment.name,
      );
      if (!declared) return;
      const bytes = await client().getAttachment(
        retrieved.fingerprint,
        declared.name,
        declared.sha256,
      );
      onSaved(
        await saveBytesToFile(
          bytes,
          declared.name,
          undefined,
          declared.media_type,
        ),
      );
    });

  return (
    <div className="capsule-tab" data-testid="capsule-registry">
      <p className="capsule-note">
        {t(
          "Optional: a registry publishes manifests, their attachments and reviews, never workspaces. Everything it returns is checked here.",
        )}
      </p>
      <label className="row">
        {t("Registry address")}
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="https://"
          data-testid="capsule-registry-address"
        />
      </label>
      <label className="row">
        {t("Publishing token (kept for this session only)")}
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          data-testid="capsule-registry-token"
        />
      </label>
      <div className="actions">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          data-testid="capsule-registry-save"
        >
          {t("Use these settings")}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={busy || !settings.address}
          data-testid="capsule-registry-refresh"
        >
          {t("List revisions")}
        </button>
      </div>
      {status && <p data-testid="capsule-registry-status">{status}</p>}
      {list && (
        <table className="capsule-table" data-testid="capsule-registry-list">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Fingerprint")}</th>
              <th>{t("Parent")}</th>
              <th>{t("Attachments")}</th>
              <th>{t("Reviews")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((revision) => (
              <tr key={revision.fingerprint} data-testid="capsule-registry-row">
                <td>{revision.name}</td>
                <td>
                  <code>{shortId(revision.fingerprint)}</code>
                </td>
                <td>
                  <code>{shortId(revision.revision_of)}</code>
                </td>
                <td>{revision.attachments.length}</td>
                <td>{revision.reviews}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => retrieve(revision)}
                    disabled={busy}
                    data-testid="capsule-registry-retrieve"
                  >
                    {t("Retrieve")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {retrieved && (
        <section data-testid="capsule-registry-retrieved">
          <h3>{retrieved.summary.name}</h3>
          <p>
            {t(
              "Manifest checked: valid, fingerprint {fingerprint}. Added to the revisions of this browser.",
              { fingerprint: shortId(retrieved.fingerprint) },
            )}
          </p>
          <h4>{t("Reviews")}</h4>
          {retrieved.reviews.length === 0 ? (
            <p>{t("none")}</p>
          ) : (
            <ul>
              {retrieved.reviews.map((entry, index) => (
                <li key={index} data-testid="capsule-registry-review">
                  {entry.review
                    ? `${entry.review.reviewer.name}: ${entry.review.statement}`
                    : ""}{" "}
                  ({entry.status === "valid" ? t("valid") : entry.status})
                </li>
              ))}
            </ul>
          )}
          {retrieved.summary.attachments.length > 0 && (
            <AttachmentsSection
              attachments={retrieved.summary.attachments.filter((a) =>
                retrieved.stored.has(a.name),
              )}
              busy={busy}
              onDownload={saveAttachment}
            />
          )}
        </section>
      )}
    </div>
  );
}
