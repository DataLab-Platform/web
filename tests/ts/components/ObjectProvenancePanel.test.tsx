import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ObjectProvenancePanel,
  formatParameterValue,
  shortDate,
} from "../../../src/components/ObjectProvenancePanel";
import type {
  ProvenanceActivity,
  ProvenanceDescription,
  ProvenanceReport,
} from "../../../src/runtime/runtime";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";

function activity(overrides: Partial<ProvenanceActivity>): ProvenanceActivity {
  return {
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
    parameters: { method: "maximum" },
    input_count: 1,
    inputs: [
      {
        position: 0,
        role: "source",
        state_id: "st1",
        object_uuid: "u1",
        id: "s1",
        title: "<b>S1</b>",
        object_kind: "signal",
        object_present: true,
        produced_by: "a1",
        has_ancestors: true,
        cycle: false,
        data: "unchecked",
      },
    ],
    outputs: [
      {
        role: "result",
        recorded: "state",
        state_id: "st2",
        object_uuid: "u2",
        id: "s2",
        title: "S2",
        object_present: true,
        status: "unchecked",
      },
    ],
    no_result: false,
    context: {},
    environment: null,
    limits: [],
    support: { function: "known", verification: "qualified", reason: null },
    legacy: null,
    ...overrides,
  };
}

function description(
  overrides: Partial<ProvenanceDescription> = {},
): ProvenanceDescription {
  return {
    available: true,
    inspection: 1,
    object: { object_uuid: "u2", id: "s2", title: "S2", present: true },
    state: { state_id: "st2" },
    anchor: { latest: true, content: "unchecked", file_status: null },
    production: activity({}),
    object_states: [],
    legacy: [],
    analyses: [],
    limits: [],
    ...overrides,
  };
}

const checked = description({
  anchor: { latest: true, content: "matches", file_status: null },
  production: activity({
    inputs: [{ ...activity({}).inputs[0], data: "changed" }],
  }),
});

const ancestor = description({
  object: { object_uuid: "u1", id: "s1", title: "S1", present: true },
  state: { state_id: "st1" },
  anchor: { latest: false, content: "unchecked", file_status: null },
  production: activity({
    activity_id: "a1",
    operation: { id: "sigima.signal.gaussian_filter", contract_version: 1 },
    parameters: { sigma: 2 },
    inputs: [],
    input_count: 0,
  }),
});

describe("formatParameterValue", () => {
  it("shows arrays by type and shape, and bounds long values", () => {
    expect(
      formatParameterValue({
        $ndarray: { dtype: "<f8", shape: [3, 3], base64: "AAAA" },
      }),
    ).toBe("array 3×3 (<f8)");
    expect(formatParameterValue({ $float: "NaN" })).toBe("NaN");
    expect(formatParameterValue({ $tuple: [1, 2] })).toBe("(1, 2)");
    expect(formatParameterValue(Array.from({ length: 20 }, (_, i) => i))).toBe(
      "[0, 1, 2, 3, 4, 5, 6, 7, …] (20)",
    );
    expect(formatParameterValue("x".repeat(500)).length).toBe(120);
  });
});

describe("ObjectProvenancePanel", () => {
  it("consults, expands an input and checks the data on request", async () => {
    const describeObjectProvenance = vi.fn(
      async (
        _oid: string,
        options: { stateId?: string; checkData?: boolean } = {},
      ) => {
        if (options.stateId) return ancestor;
        return options.checkData ? checked : description();
      },
    );
    const runtime = {
      describeObjectProvenance,
      replayActivity: vi.fn(),
    } as unknown as RuntimeApi;

    const { container } = render(
      <ObjectProvenancePanel runtime={runtime} oid="s2" refreshNonce={0} />,
    );

    const summary = await screen.findByTestId("provenance-summary");
    expect(summary.textContent).toContain("Data to be checked");
    expect(screen.getByText("sigima.signal.normalize")).toBeTruthy();
    expect(screen.getByText("maximum")).toBeTruthy();
    // Titles are text, never markup.
    expect(screen.getByText("source: <b>S1</b>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    expect(describeObjectProvenance).toHaveBeenCalledWith("s2");

    fireEvent.click(screen.getByRole("button", { name: "Show recorded step" }));
    expect(
      await screen.findByText("sigima.signal.gaussian_filter"),
    ).toBeTruthy();
    expect(describeObjectProvenance).toHaveBeenCalledWith("s2", {
      stateId: "st1",
      trail: ["st2"],
      checkData: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Check data" }));
    expect(
      await screen.findByText("This input has changed since the computation"),
    ).toBeTruthy();
    expect(
      screen.getByText("The object holds the recorded state"),
    ).toBeTruthy();
    expect(describeObjectProvenance).toHaveBeenCalledWith("s2", {
      checkData: true,
    });
    // The expanded earlier step is checked too.
    await waitFor(() =>
      expect(describeObjectProvenance).toHaveBeenCalledWith("s2", {
        stateId: "st1",
        trail: ["st2"],
        checkData: true,
      }),
    );
  });

  it("names the software that recorded a step", async () => {
    const runtime = {
      describeObjectProvenance: vi.fn(async () =>
        description({
          production: activity({
            edition: "desktop",
            environment: { edition: "desktop", edition_version: "1.3.0" },
          }),
        }),
      ),
      replayActivity: vi.fn(),
    } as unknown as RuntimeApi;
    render(
      <ObjectProvenancePanel runtime={runtime} oid="s2" refreshNonce={0} />,
    );
    expect(
      await screen.findByText("Software: DataLab Desktop 1.3.0"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Processing — DataLab Desktop — ${shortDate("2026-10-16T00:00:00Z")}`,
      ),
    ).toBeTruthy();
  });

  it("verifies the computation and shows the verdict", async () => {
    const report = {
      activity_id: "a2",
      verdict: "not_verified",
      eligibility: "input_changed",
      reason: "Input changed since the activity",
      environment: { match: "same" },
      outputs: [],
    } as unknown as ProvenanceReport;
    const replayActivity = vi.fn(async () => report);
    const runtime = {
      describeObjectProvenance: vi.fn(async () => description()),
      replayActivity,
    } as unknown as RuntimeApi;

    render(
      <ObjectProvenancePanel runtime={runtime} oid="s2" refreshNonce={0} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Verify computation" }),
    );
    expect(await screen.findByText(/Verification: Not verified/)).toBeTruthy();
    expect(screen.getByText("Input changed since the activity")).toBeTruthy();
    expect(replayActivity).toHaveBeenCalledWith("a2");
  });

  it("never shows a result that arrives after the selection changed", async () => {
    let resolveCheck!: (value: ProvenanceDescription) => void;
    const other = description({
      object: { object_uuid: "u3", id: "s3", title: "S3", present: true },
      production: null,
      state: { state_id: "st3" },
    });
    const runtime = {
      describeObjectProvenance: vi.fn(
        (oid: string, options: { checkData?: boolean } = {}) => {
          if (options.checkData) {
            return new Promise<ProvenanceDescription>((resolve) => {
              resolveCheck = resolve;
            });
          }
          return Promise.resolve(oid === "s3" ? other : description());
        },
      ),
      replayActivity: vi.fn(),
    } as unknown as RuntimeApi;

    const { rerender } = render(
      <ObjectProvenancePanel runtime={runtime} oid="s2" refreshNonce={0} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Check data" }));
    rerender(
      <ObjectProvenancePanel runtime={runtime} oid="s3" refreshNonce={0} />,
    );
    expect(
      await screen.findByText(
        "This state was observed, without recorded production.",
      ),
    ).toBeTruthy();
    resolveCheck(checked);
    await waitFor(() =>
      expect(
        screen.queryByText("This input has changed since the computation"),
      ).toBeNull(),
    );
    expect(
      screen.queryByText("The object holds the recorded state"),
    ).toBeNull();
  });

  it("says when provenance is not available", async () => {
    const runtime = {
      describeObjectProvenance: vi.fn(async () => ({
        available: false,
        reason: "DataLab-Capsule is not installed",
      })),
    } as unknown as RuntimeApi;
    render(
      <ObjectProvenancePanel runtime={runtime} oid="s2" refreshNonce={0} />,
    );
    expect(
      await screen.findByText(
        "Provenance is not available in this session: processing works as usual.",
        { exact: false },
      ),
    ).toBeTruthy();
    expect(screen.getByText("DataLab-Capsule is not installed")).toBeTruthy();
  });
});

describe("shortDate", () => {
  it("shows a recorded UTC time as a short local date and time", () => {
    const local = new Date("2026-10-16T13:32:23.759Z");
    const pad = (value: number) => String(value).padStart(2, "0");
    expect(shortDate("2026-10-16T13:32:23.759Z")).toBe(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`,
    );
    expect(shortDate(null)).toBe("");
    expect(shortDate("not a date")).toBe("not a date");
  });
});

describe("Go to object", () => {
  it("selects the object holding an input, with an explicit tooltip", async () => {
    const onSelectObject = vi.fn();
    const runtime = {
      describeObjectProvenance: vi.fn(async () => description()),
      replayActivity: vi.fn(),
    } as unknown as RuntimeApi;
    render(
      <ObjectProvenancePanel
        runtime={runtime}
        oid="s2"
        refreshNonce={0}
        onSelectObject={onSelectObject}
      />,
    );
    const button = await screen.findByRole("button", { name: "Go to object" });
    expect(button.getAttribute("title")).toContain("signal or image panel");
    fireEvent.click(button);
    expect(onSelectObject).toHaveBeenCalledWith("s1", "signal");
  });
});
