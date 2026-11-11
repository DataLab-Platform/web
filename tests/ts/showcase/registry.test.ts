import { describe, expect, it } from "vitest";
import type { ActionState } from "../../../src/actions/types";
import type { PluginRecord, RuntimeApi } from "../../../src/runtime/runtime";
import { ShowcaseContext } from "../../../src/showcase/engine";
import {
  getShowcaseScenarios,
  interleave,
  NATIVE_SCENARIOS,
  selectScenarios,
} from "../../../src/showcase/index";
import type { ShowcaseHost } from "../../../src/showcase/launch";

function plugin(
  id: string,
  capabilities: string[],
  over: Partial<PluginRecord> = {},
): PluginRecord {
  return {
    name: id,
    record_id: id,
    plugin_id: id,
    loaded: true,
    enabled: true,
    info: {
      id,
      name: `Plugin ${id}`,
      version: "1.0",
      description: `About ${id}`,
      icon: null,
      capabilities,
      documentation_url: null,
    },
    ...over,
  } as unknown as PluginRecord;
}

function host(records: PluginRecord[]): ShowcaseHost {
  return {
    runtime: {} as RuntimeApi,
    getActions: () => [],
    getActionState: () => ({}) as ActionState,
    getPluginRecords: () => records,
    resetWorkspace: async () => undefined,
  };
}

describe("showcase registry", () => {
  it("lists the native scenarios in playing order", () => {
    expect(NATIVE_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "w1",
      "w2",
      "w3",
      "w4",
    ]);
    for (const scenario of NATIVE_SCENARIOS) {
      expect(scenario.title()).not.toBe("");
    }
  });

  it("interleaves application scenarios between native ones", () => {
    expect(interleave(["w1", "w2", "w3", "w4"], ["a", "b"])).toEqual([
      "w1",
      "a",
      "w2",
      "b",
      "w3",
      "w4",
    ]);
    expect(interleave(["w1"], ["a", "b", "c"])).toEqual(["w1", "a", "b", "c"]);
    expect(interleave([], [])).toEqual([]);
  });

  it("selects scenarios by id in registry order", () => {
    const { scenarios, unknown } = selectScenarios(NATIVE_SCENARIOS, [
      "w3",
      "W1",
      "nope",
    ]);
    expect(scenarios.map((scenario) => scenario.id)).toEqual(["w1", "w3"]);
    expect(unknown).toEqual(["nope"]);
    expect(selectScenarios(NATIVE_SCENARIOS, null).scenarios).toBe(
      NATIVE_SCENARIOS,
    );
  });

  it("generates one scenario per loaded application plugin", async () => {
    const records = [
      plugin("org.example.camera", ["application", "processing"]),
      plugin("org.example.filters", ["processing"]),
      plugin("org.example.disabled", ["application"], { enabled: false }),
      plugin("org.example.pulse", ["application"]),
    ];
    const ctx = new ShowcaseContext(host(records), { speed: 0 });
    const scenarios = await getShowcaseScenarios(ctx);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "w1",
      "app:org.example.camera",
      "w2",
      "app:org.example.pulse",
      "w3",
      "w4",
    ]);
    expect(scenarios[1].title()).toBe("Plugin org.example.camera");
  });
});
