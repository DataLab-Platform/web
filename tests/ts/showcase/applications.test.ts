import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionState } from "../../../src/actions/types";
import { setActiveLocale } from "../../../src/i18n/locale";
import type {
  PluginExampleSummary,
  PluginRecipeSummary,
  PluginRecord,
  RuntimeApi,
} from "../../../src/runtime/runtime";
import {
  applicationScenarioId,
  createApplicationScenarios,
} from "../../../src/showcase/applications";
import {
  describeObjects,
  newObjects,
  parseCreatedCount,
  pickDemoSteps,
  planApplicationDemo,
  readingTime,
  type WorkspaceObject,
} from "../../../src/showcase/applications_plan";
import {
  captionSideFor,
  treeItemId,
} from "../../../src/showcase/applications_ui";
import { ShowcaseContext } from "../../../src/showcase/engine";
import type { ShowcaseHost } from "../../../src/showcase/launch";

function recipe(id: string): PluginRecipeSummary {
  return {
    id: `org.example.app:${id}`,
    version: "1.0.0",
    title: `Method ${id}`,
    description: `About method ${id}`,
    inputs: [],
    has_params: true,
  };
}

function example(id: string, recipeIds: string[]): PluginExampleSummary {
  return {
    id,
    title: `Example ${id}`,
    description: `About example ${id}`,
    recipe_ids: recipeIds.map((name) => `org.example.app:${name}`),
    expected_checks: [],
  };
}

function application(over: Partial<PluginRecord> = {}): PluginRecord {
  return {
    name: "app",
    record_id: "bundled:app",
    plugin_id: "org.example.app",
    loaded: true,
    enabled: true,
    info: {
      id: "org.example.App",
      name: "Example application",
      version: "1.0",
      description: "  Measures things.  ",
      icon: null,
      capabilities: ["application"],
      documentation_url: null,
    },
    recipes: [recipe("a"), recipe("b"), recipe("c")],
    examples: [],
    tools: [],
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

const ids = (steps: ReturnType<typeof pickDemoSteps>) =>
  steps.map((step) => `${step.example.id}→${step.recipe.id.split(":")[1]}`);

afterEach(() => {
  setActiveLocale("en", { reload: false });
  vi.useRealTimers();
});

describe("application demo plan", () => {
  const recipes = [recipe("a"), recipe("b"), recipe("c")];

  it("plays the first examples in declared order, one method each", () => {
    const steps = pickDemoSteps(recipes, [
      example("quickstart", ["a"]),
      example("ladder", ["b", "a"]),
      example("ramp", ["c"]),
    ]);
    expect(ids(steps)).toEqual(["quickstart→a", "ladder→b"]);
  });

  it("prefers a method not shown yet, then fills with the others", () => {
    const steps = pickDemoSteps(recipes, [
      example("demo", ["a"]),
      example("again", ["a"]),
      example("other", ["a", "c"]),
    ]);
    expect(ids(steps)).toEqual(["demo→a", "other→c"]);
    expect(
      ids(pickDemoSteps(recipes, [example("x", ["a"]), example("y", ["a"])])),
    ).toEqual(["x→a", "y→a"]);
    expect(ids(pickDemoSteps(recipes, [example("x", ["a"])], 3))).toEqual([
      "x→a",
    ]);
  });

  it("ignores datasets and recipes the plugin does not declare", () => {
    const steps = pickDemoSteps(recipes, [
      example("dataset", []),
      example("stale", ["gone"]),
      example("mixed", ["gone", "b"]),
    ]);
    expect(ids(steps)).toEqual(["mixed→b"]);
    expect(pickDemoSteps([], [example("x", ["a"])])).toEqual([]);
  });

  it("derives the demo from the plugin contracts only", () => {
    const plan = planApplicationDemo(
      application({
        examples: [example("quickstart", ["a"]), example("ladder", ["b"])],
      }),
    );
    expect(plan).toMatchObject({
      pluginId: "org.example.app",
      name: "Example application",
      description: "Measures things.",
      listed: true,
    });
    expect(ids(plan.steps)).toEqual(["quickstart→a", "ladder→b"]);
  });

  it("falls back to the page when no example targets a method", () => {
    const plan = planApplicationDemo(
      application({ examples: [example("dataset", [])] }),
    );
    expect(plan.listed).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it("knows when the Applications window does not list the plugin", () => {
    expect(planApplicationDemo(application({ plugin_id: null })).listed).toBe(
      false,
    );
    const empty = planApplicationDemo(
      application({ recipes: [], examples: [], tools: [] }),
    );
    expect(empty).toMatchObject({ listed: false, steps: [] });
  });
});

describe("application demo helpers", () => {
  const objects: WorkspaceObject[] = [
    { id: "1", kind: "signal", title: "s1" },
    { id: "1", kind: "image", title: "i1" },
  ];

  it("lists the new objects", () => {
    const after: WorkspaceObject[] = [
      ...objects,
      { id: "2", kind: "signal", title: "s2" },
      { id: "3", kind: "image", title: "i3" },
    ];
    expect(newObjects(objects, after).map((obj) => obj.title)).toEqual([
      "s2",
      "i3",
    ]);
    expect(newObjects(after, objects)).toEqual([]);
  });

  it("describes objects per kind, in both languages", () => {
    const many: WorkspaceObject[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `i${i}`,
        kind: "image" as const,
        title: "",
      })),
      { id: "s", kind: "signal", title: "" },
    ];
    expect(describeObjects(many)).toBe("5 images and 1 signal");
    expect(describeObjects(many.slice(0, 1))).toBe("1 image");
    expect(describeObjects([])).toBe("");
    setActiveLocale("fr", { reload: false });
    expect(describeObjects(many)).toBe("5 images et 1 signal");
  });

  it("reads the number of created objects in the status line", () => {
    expect(parseCreatedCount("Created 10 objects")).toBe(10);
    expect(parseCreatedCount(" Created 3 objects ")).toBe(3);
    expect(parseCreatedCount("Example opened")).toBeNull();
    expect(parseCreatedCount(null)).toBeNull();
    setActiveLocale("fr", { reload: false });
    expect(parseCreatedCount("10 objets créés")).toBe(10);
  });

  it("holds captions long enough to read them", () => {
    expect(readingTime("short")).toBe(2500);
    expect(readingTime("x".repeat(500))).toBe(7000);
    expect(readingTime("x".repeat(100))).toBe(5600);
  });

  it("reads tree item IDs and places captions away from targets", () => {
    const item = document.createElement("li");
    item.innerHTML =
      '<span class="object-tree-title">A</span>' +
      '<div class="object-tree-meta">#9611e8ca · 21 pts</div>';
    expect(treeItemId(item)).toBe("9611e8ca");
    expect(treeItemId(document.createElement("li"))).toBeNull();

    const el = document.createElement("div");
    const at = (top: number, bottom: number) =>
      vi
        .spyOn(el, "getBoundingClientRect")
        .mockReturnValue({ top, bottom } as DOMRect);
    at(window.innerHeight - 100, window.innerHeight - 50);
    expect(captionSideFor(el)).toEqual({ position: "top" });
    at(10, 60);
    expect(captionSideFor(el)).toEqual({ position: "bottom" });
    expect(captionSideFor(null)).toEqual({});
  });
});

describe("application scenarios", () => {
  it("are identified by plugin ID", () => {
    expect(applicationScenarioId(application())).toBe("app:org.example.app");
    expect(
      applicationScenarioId(application({ info: null, plugin_id: null })),
    ).toBe("app:bundled:app");
  });

  it("are generated for the loaded application plugins only", async () => {
    const records = [
      application(),
      application({
        plugin_id: "org.example.filters",
        info: { ...application().info!, capabilities: ["processing"] },
      }),
    ];
    const ctx = new ShowcaseContext(host(records), { speed: 0 });
    const scenarios = await createApplicationScenarios(ctx);
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      "app:org.example.app",
    ]);
    expect(scenarios[0].title()).toBe("Example application");
    expect(scenarios[0].subtitle?.()).toBe("Application plugin");
  });

  it("are none when no plugin is available", async () => {
    vi.useFakeTimers();
    const ctx = new ShowcaseContext(host([]), { speed: 0 });
    const pending = createApplicationScenarios(ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual([]);
  });
});
