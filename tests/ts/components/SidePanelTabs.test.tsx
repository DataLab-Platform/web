import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DialogProvider } from "../../../src/components/ConfirmDialog";
import {
  SidePanel,
  type SideTabRequest,
} from "../../../src/components/SidePanel";
import type {
  ProvenanceActivity,
  ProvenanceDescription,
  RuntimeApi,
} from "../../../src/runtime/runtime";

/** Recorded production of "s2" from the input "s1" (Provenance tab). */
function provenance(): ProvenanceDescription {
  const production: ProvenanceActivity = {
    activity_id: "a2",
    command_id: null,
    origin: "ordinary",
    edition: "web",
    status: "completed",
    started_at: null,
    finished_at: "2026-10-16T00:00:00Z",
    operation: { id: "sigima.signal.normalize", contract_version: 1 },
    opaque: false,
    implementation: null,
    parameters: {},
    input_count: 1,
    inputs: [
      {
        position: 0,
        role: "source",
        state_id: "st1",
        object_uuid: "u1",
        id: "s1",
        title: "S1",
        object_kind: "signal",
        object_present: true,
        produced_by: null,
        has_ancestors: false,
        cycle: false,
        data: "unchecked",
      },
    ],
    outputs: [],
    no_result: false,
    context: {},
    environment: null,
    limits: [],
    support: { function: "known", verification: "qualified", reason: null },
    legacy: null,
  };
  return {
    available: true,
    inspection: 1,
    object: { object_uuid: "u2", id: "s2", title: "S2", present: true },
    state: { state_id: "st2" },
    anchor: { latest: true, content: "unchecked", file_status: null },
    production,
    object_states: [],
    legacy: [],
    analyses: [],
    limits: [],
  };
}

const runtime = {
  getLastProcessing: vi.fn(async () => null),
  getCreationParamSchema: vi.fn(async () => null),
  getPropertiesSnapshot: vi.fn(async () => null),
  describeObjectProvenance: vi.fn(async () => provenance()),
  replayActivity: vi.fn(),
} as unknown as RuntimeApi;

function Panel(props: {
  currentId: string | null;
  tabRequest?: SideTabRequest | null;
  refreshNonce?: number;
  onSelectObject?: (oid: string, kind: "signal" | "image") => void;
}) {
  return (
    <DialogProvider>
      <SidePanel
        runtime={runtime}
        currentId={props.currentId}
        panelKind="signal"
        refreshNonce={props.refreshNonce ?? 0}
        onObjectChanged={() => undefined}
        tabRequest={props.tabRequest ?? null}
        results={[]}
        onClearResults={() => undefined}
        onSelectObject={props.onSelectObject}
      />
    </DialogProvider>
  );
}

/** Panel whose selection follows "Go to object", like ``App``. */
function NavigablePanel() {
  const [currentId, setCurrentId] = useState("s2");
  return (
    <>
      <button type="button" onClick={() => setCurrentId("s3")}>
        select s3
      </button>
      <Panel
        currentId={currentId}
        onSelectObject={(oid) => setCurrentId(oid)}
      />
    </>
  );
}

function selectedTab(): string | null {
  const tab = screen
    .getAllByRole("tab")
    .find((item) => item.getAttribute("aria-selected") === "true");
  return tab?.textContent ?? null;
}

describe("SidePanel tab, as in DataLab desktop", () => {
  it("shows the tab requested for an object once", () => {
    const request: SideTabRequest = { tab: "creation", oid: "a", seq: 1 };
    const view = render(<Panel currentId="a" tabRequest={request} />);
    expect(selectedTab()).toBe("Creation");

    view.rerender(<Panel currentId="b" tabRequest={request} />);
    expect(selectedTab()).toBe("Properties");

    view.rerender(<Panel currentId="a" tabRequest={request} />);
    expect(selectedTab()).toBe("Properties");
  });

  it("shows the requested tab when its object gets selected afterwards", () => {
    const request: SideTabRequest = { tab: "creation", oid: "b", seq: 1 };
    const view = render(<Panel currentId="a" tabRequest={request} />);
    expect(selectedTab()).toBe("Properties");

    view.rerender(<Panel currentId="b" tabRequest={request} />);
    expect(selectedTab()).toBe("Creation");
  });

  it("shows Results after an analysis of the current object", () => {
    const view = render(<Panel currentId="a" />);
    fireEvent.click(screen.getByRole("tab", { name: "Provenance" }));

    view.rerender(
      <Panel currentId="a" tabRequest={{ tab: "results", oid: "a", seq: 1 }} />,
    );
    expect(selectedTab()).toBe("Results");
  });

  it("keeps the tab when the same object is shown again", () => {
    const view = render(<Panel currentId="a" />);
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));

    view.rerender(<Panel currentId="a" refreshNonce={1} />);
    expect(selectedTab()).toBe("Results");
  });

  it("shows Properties when another object is selected", () => {
    const view = render(<Panel currentId="a" />);
    fireEvent.click(screen.getByRole("tab", { name: "Provenance" }));

    view.rerender(<Panel currentId="b" />);
    expect(selectedTab()).toBe("Properties");
  });

  it("keeps the Provenance tab when going to an input", async () => {
    render(<NavigablePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Provenance" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Go to object" }),
    );
    expect(selectedTab()).toBe("Provenance");
    expect(runtime.describeObjectProvenance).toHaveBeenLastCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: "select s3" }));
    expect(selectedTab()).toBe("Properties");
  });
});
