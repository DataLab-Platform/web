import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CapsuleDialog } from "../../../src/components/CapsuleDialog";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";
import type {
  CapsuleInspection,
  ProvenanceLedgerInfo,
} from "../../../src/runtime/runtime";
import {
  listRevisions,
  recordRevision,
  type CapsuleRevision,
} from "../../../src/storage/capsuleRevisions";
import {
  saveBytesToFile,
  saveGeneratedFile,
} from "../../../src/utils/saveFile";

vi.mock("../../../src/storage/capsuleRevisions", () => ({
  listRevisions: vi.fn(),
  recordRevision: vi.fn(),
}));
vi.mock("../../../src/utils/saveFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/utils/saveFile")>()),
  saveGeneratedFile: vi.fn(),
  saveBytesToFile: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const INFO: ProvenanceLedgerInfo = {
  available: true,
  reason: null,
  ledger: null,
  state_status: {},
  artifact_status: {},
  legacy: null,
  capture_failures: 0,
  notices: [],
  file_status: null,
  capsule_origin: null,
};

function inspection(name: string): CapsuleInspection {
  return {
    summary: {
      name,
      description: "",
      license: "",
      date_published: "2026-10-19",
      profiles: [],
      fingerprint: `sha256:${name}`,
      revision_of: null,
      workspace: {
        id: "workspace.h5",
        referenced: false,
        sha256: "",
        size: "1",
      },
      attachments: [],
      activities: [],
      states: [],
      fan_out: [],
    },
    manifest: { name },
    integrity: {
      valid: true,
      fingerprint: `sha256:${name}`,
      workspace: "verified",
      states_located: 0,
      states_altered: [],
      problems: [],
    },
    documents: null,
  };
}

function revision(name: string): CapsuleRevision {
  return {
    fingerprint: `sha256:${name}`,
    name,
    revisionOf: null,
    datePublished: "2026-10-19",
    source: "exported",
    recordedAt: 1,
    manifest: { name },
  };
}

const runtime = {
  getProvenanceLedger: vi.fn<RuntimeApi["getProvenanceLedger"]>(),
  exportWorkspaceCapsule: vi.fn<RuntimeApi["exportWorkspaceCapsule"]>(),
  exportReferencedCapsule: vi.fn<RuntimeApi["exportReferencedCapsule"]>(),
  inspectWorkspaceCapsule: vi.fn<RuntimeApi["inspectWorkspaceCapsule"]>(),
  diffCapsuleManifests: vi.fn<RuntimeApi["diffCapsuleManifests"]>(),
};

function openDialog() {
  return render(
    <CapsuleDialog
      runtime={runtime as RuntimeApi}
      onClose={vi.fn()}
      onOpened={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

async function exportNamed(name: string) {
  fireEvent.change(screen.getByTestId("capsule-name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByTestId("capsule-export-button"));
  await waitFor(() => expect(saveGeneratedFile).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetAllMocks();
  runtime.getProvenanceLedger.mockResolvedValue(INFO);
  runtime.exportWorkspaceCapsule.mockResolvedValue(new Uint8Array([1]));
  runtime.exportReferencedCapsule.mockResolvedValue({
    capsule: new Uint8Array([1]),
    workspace: new Uint8Array([2]),
  });
  runtime.inspectWorkspaceCapsule.mockResolvedValue(inspection("first"));
  vi.mocked(listRevisions).mockResolvedValue([]);
  vi.mocked(recordRevision).mockResolvedValue();
  vi.mocked(saveGeneratedFile).mockImplementation(async (produce, filename) => {
    await produce();
    return { outcome: "downloaded", filename };
  });
  vi.mocked(saveBytesToFile).mockResolvedValue({
    outcome: "downloaded",
    filename: "referenced.dlcapsule",
  });
});

describe("CapsuleDialog export completion", () => {
  it("keeps the export mounted until inspection, persistence and refresh finish", async () => {
    const inspected = deferred<CapsuleInspection>();
    const recorded = deferred<void>();
    const refreshed = deferred<CapsuleRevision[]>();
    runtime.inspectWorkspaceCapsule.mockReturnValueOnce(inspected.promise);
    vi.mocked(recordRevision).mockReturnValueOnce(recorded.promise);
    vi.mocked(listRevisions)
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(refreshed.promise);
    openDialog();
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await exportNamed("first");
    const revisionsTab = screen.getByRole("tab", { name: "Revisions" });
    expect(screen.getByTestId("capsule-export-button")).toBeDisabled();
    fireEvent.click(revisionsTab);
    expect(screen.getByTestId("capsule-export")).toBeInTheDocument();
    expect(revisionsTab).toBeDisabled();
    await act(async () => inspected.resolve(inspection("first")));
    expect(recordRevision).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("capsule-export-button")).toBeDisabled();
    await act(async () => recorded.resolve());
    expect(listRevisions).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("capsule-export-button")).toBeDisabled();
    await act(async () => refreshed.resolve([revision("first")]));
    await waitFor(() =>
      expect(screen.getByTestId("capsule-export-button")).toBeEnabled(),
    );
    runtime.inspectWorkspaceCapsule.mockResolvedValueOnce(inspection("second"));
    vi.mocked(listRevisions).mockResolvedValueOnce([
      revision("second"),
      revision("first"),
    ]);
    await exportNamed("second");
    await waitFor(() =>
      expect(screen.getByTestId("capsule-export-button")).toBeEnabled(),
    );
    fireEvent.click(revisionsTab);
    fireEvent.change(screen.getByTestId("capsule-diff-old"), {
      target: { value: "sha256:first" },
    });
    fireEvent.change(screen.getByTestId("capsule-diff-new"), {
      target: { value: "sha256:second" },
    });
    expect(screen.getByTestId("capsule-diff-old")).toHaveValue("sha256:first");
    expect(screen.getByTestId("capsule-diff-new")).toHaveValue("sha256:second");
    expect(screen.getByTestId("capsule-compare")).toBeEnabled();
  });

  it("does not let an older initial read replace the exported revisions", async () => {
    const initial = deferred<CapsuleRevision[]>();
    vi.mocked(listRevisions)
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce([revision("first")]);
    openDialog();
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    await exportNamed("first");
    await waitFor(() =>
      expect(screen.getByTestId("capsule-export-button")).toBeEnabled(),
    );
    await act(async () => initial.resolve([]));
    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
    expect(
      screen.getAllByRole("option", { name: "first (first)" }),
    ).toHaveLength(2);
  });

  it("does not record a cancelled export", async () => {
    vi.mocked(saveGeneratedFile).mockResolvedValue({
      outcome: "cancelled",
      filename: "",
    });
    openDialog();
    await exportNamed("cancelled");
    await waitFor(() =>
      expect(screen.getByTestId("capsule-export-button")).toBeEnabled(),
    );
    expect(runtime.inspectWorkspaceCapsule).not.toHaveBeenCalled();
    expect(recordRevision).not.toHaveBeenCalled();
  });

  it("awaits the referenced workspace refresh before saving the capsule", async () => {
    const workspaceRefreshed = deferred<ProvenanceLedgerInfo>();
    runtime.getProvenanceLedger
      .mockResolvedValueOnce(INFO)
      .mockReturnValueOnce(workspaceRefreshed.promise);
    openDialog();
    await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Reference the workspace instead of including it",
      }),
    );
    fireEvent.change(screen.getByTestId("capsule-workspace-ref"), {
      target: { value: "https://example.org/workspace.h5" },
    });
    await exportNamed("referenced");
    await waitFor(() =>
      expect(runtime.exportReferencedCapsule).toHaveBeenCalledTimes(1),
    );
    expect(saveBytesToFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("capsule-export-button")).toBeDisabled();
    await act(async () => workspaceRefreshed.resolve(INFO));
    await waitFor(() =>
      expect(screen.getByTestId("capsule-export-button")).toBeEnabled(),
    );
    expect(saveBytesToFile).toHaveBeenCalledTimes(1);
    expect(recordRevision).toHaveBeenCalledTimes(1);
  });

  it("shows an initial refresh error rather than leaving an unhandled rejection", async () => {
    vi.mocked(listRevisions).mockRejectedValueOnce(
      new Error("initial read failed"),
    );
    openDialog();
    await waitFor(() =>
      expect(screen.getByTestId("capsule-error")).toHaveTextContent(
        "initial read failed",
      ),
    );
    expect(screen.getByTestId("capsule-export-button")).toBeEnabled();
  });

  it("does not record an export whose inspection reports invalid content", async () => {
    const invalid = inspection("invalid");
    invalid.integrity.valid = false;
    invalid.integrity.problems = ["workspace mismatch"];
    runtime.inspectWorkspaceCapsule.mockResolvedValueOnce(invalid);
    openDialog();
    await exportNamed("invalid");
    await waitFor(() =>
      expect(screen.getByTestId("capsule-error")).toHaveTextContent(
        "workspace mismatch",
      ),
    );
    expect(recordRevision).not.toHaveBeenCalled();
    expect(screen.getByTestId("capsule-export-button")).toBeEnabled();
  });

  it.each(["save", "inspect", "record", "refresh"])(
    "shows a %s error and makes the dialog usable again",
    async (stage) => {
      const error = new Error(`${stage} failed`);
      if (stage === "save")
        vi.mocked(saveGeneratedFile).mockRejectedValue(error);
      if (stage === "inspect")
        runtime.inspectWorkspaceCapsule.mockRejectedValue(error);
      if (stage === "record")
        vi.mocked(recordRevision).mockRejectedValue(error);
      if (stage === "refresh")
        vi.mocked(listRevisions)
          .mockResolvedValueOnce([])
          .mockRejectedValueOnce(error);
      openDialog();
      await waitFor(() => expect(listRevisions).toHaveBeenCalledTimes(1));
      await exportNamed("first");
      await waitFor(() =>
        expect(screen.getByTestId("capsule-error")).toHaveTextContent(
          `${stage} failed`,
        ),
      );
      expect(screen.getByTestId("capsule-export-button")).toBeEnabled();
      expect(screen.getByRole("tab", { name: "Revisions" })).toBeEnabled();
      if (stage === "save" || stage === "inspect")
        expect(recordRevision).not.toHaveBeenCalled();
    },
  );
});
