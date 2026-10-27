import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstrumentWindow } from "../../../src/components/InstrumentWindow";
import type {
  PluginInstrumentFrame,
  PluginInstrumentSession,
} from "../../../src/runtime/runtime";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";

const runtimeMock = vi.hoisted(() => ({
  openPluginInstrument: vi.fn(),
  previewPluginInstrument: vi.fn(),
  acquirePluginInstrument: vi.fn(),
  resolvePluginInstrumentActive: vi.fn(),
}));

vi.mock("../../../src/runtime/RuntimeContext", () => ({
  useRuntime: () => ({ runtime: runtimeMock as unknown as RuntimeApi }),
}));

vi.mock("../../../src/components/InstrumentPlot", () => ({
  default: ({ frame }: { frame: PluginInstrumentFrame }) => (
    <div data-testid="instrument-plot">
      {frame.kind}:{frame.items.length}
    </div>
  ),
}));

const SESSION: PluginInstrumentSession = {
  plugin_id: "org.example.camera",
  tool_id: "simulator",
  title: "Camera simulator",
  live_interval_ms: 20,
  new_group: true,
  settings: {
    schema: {
      type: "object",
      properties: {
        exposure: {
          type: "number",
          "x-guidata-kind": "float",
          "x-guidata-label": "Exposure time",
          "x-guidata-name": "exposure",
        },
      },
      "x-guidata-property-order": ["exposure"],
    },
    values: { exposure: 10 },
  },
};

const FRAME: PluginInstrumentFrame = {
  kind: "signals",
  items: [],
  summary: "Mean 400 DN",
  value_range: [0, 4095],
};

const NEW_GROUP_KEY =
  "datalab-web.instrument-new-group.org.example.camera/simulator";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem(NEW_GROUP_KEY);
  runtimeMock.openPluginInstrument.mockResolvedValue(SESSION);
  runtimeMock.previewPluginInstrument.mockResolvedValue(FRAME);
  runtimeMock.resolvePluginInstrumentActive.mockResolvedValue({});
  runtimeMock.acquirePluginInstrument.mockResolvedValue({
    panel: "image",
    group_id: "g1",
    group_title: "Camera acquisition 001",
    object_ids: ["image-1", "image-2"],
  });
});

function renderWindow(props: Partial<Parameters<typeof InstrumentWindow>[0]>) {
  return render(
    <InstrumentWindow
      pluginId="org.example.camera"
      toolId="simulator"
      currentGroupId={() => "g0"}
      onAcquired={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("InstrumentWindow", () => {
  it("shows a live frame for the settings, then acquires into a group", async () => {
    const onAcquired = vi.fn();
    renderWindow({ onAcquired });

    expect(
      await screen.findByRole("dialog", { name: "Camera simulator" }),
    ).toBeTruthy();
    expect(await screen.findByTestId("instrument-plot")).toBeTruthy();
    expect(screen.getByText("Mean 400 DN")).toBeTruthy();
    expect(runtimeMock.previewPluginInstrument).toHaveBeenCalledWith(
      "org.example.camera",
      "simulator",
      { exposure: 10 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Acquire" }));
    await waitFor(() =>
      expect(onAcquired).toHaveBeenCalledWith(
        expect.objectContaining({ group_title: "Camera acquisition 001" }),
      ),
    );
    expect(runtimeMock.acquirePluginInstrument).toHaveBeenCalledWith(
      "org.example.camera",
      "simulator",
      { exposure: 10 },
      true,
      null,
    );
    expect(
      await screen.findByText(
        "2 objects added to group 'Camera acquisition 001'",
      ),
    ).toBeTruthy();
  });

  it("acquires into the current group when 'New group' is off", async () => {
    renderWindow({});
    await screen.findByTestId("instrument-plot");
    const newGroup = screen.getByRole("checkbox", {
      name: "New group",
    }) as HTMLInputElement;
    expect(newGroup.checked).toBe(true);

    fireEvent.click(newGroup);
    expect(newGroup.checked).toBe(false);
    expect(window.localStorage.getItem(NEW_GROUP_KEY)).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Acquire" }));
    await waitFor(() =>
      expect(runtimeMock.acquirePluginInstrument).toHaveBeenCalledWith(
        "org.example.camera",
        "simulator",
        { exposure: 10 },
        false,
        "g0",
      ),
    );
  });

  it("starts 'New group' from the instrument, then from the user's choice", async () => {
    runtimeMock.openPluginInstrument.mockResolvedValue({
      ...SESSION,
      new_group: false,
    });
    const { unmount } = renderWindow({});
    await screen.findByTestId("instrument-plot");
    const newGroup = screen.getByRole("checkbox", {
      name: "New group",
    }) as HTMLInputElement;
    expect(newGroup.checked).toBe(false);
    fireEvent.click(newGroup);
    unmount();

    renderWindow({});
    await screen.findByTestId("instrument-plot");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("checkbox", {
            name: "New group",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });

  it("refreshes the view continuously in live mode", async () => {
    renderWindow({});
    await screen.findByTestId("instrument-plot");
    const calls = runtimeMock.previewPluginInstrument.mock.calls.length;

    const live = screen.getByRole("button", { name: "Live" });
    fireEvent.click(live);
    expect(live.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() =>
      expect(
        runtimeMock.previewPluginInstrument.mock.calls.length,
      ).toBeGreaterThan(calls + 2),
    );

    fireEvent.click(live);
    const stopped = runtimeMock.previewPluginInstrument.mock.calls.length;
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 80)));
    expect(runtimeMock.previewPluginInstrument.mock.calls.length).toBe(stopped);
  });

  it("reports settings the instrument rejects", async () => {
    runtimeMock.previewPluginInstrument.mockRejectedValue(
      new Error("Exposure times must be positive"),
    );
    runtimeMock.acquirePluginInstrument.mockRejectedValue(
      new Error("This acquisition would create 400 megapixels"),
    );
    const onAcquired = vi.fn();
    renderWindow({ onAcquired });

    expect(
      await screen.findByText("Exposure times must be positive"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Acquire" }));
    expect(
      await screen.findByText("This acquisition would create 400 megapixels"),
    ).toBeTruthy();
    expect(onAcquired).not.toHaveBeenCalled();
  });
});
