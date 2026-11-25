import { afterEach, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
});

async function loadProfile(demo: boolean, search = "") {
  vi.stubEnv("VITE_WASM64_DEMO", demo ? "1" : "0");
  history.replaceState(null, "", `/${search}`);
  vi.resetModules();
  return {
    trust: await import("../../../src/plugins/trustStore"),
    registry: await import("../../../src/storage/capsuleRegistry"),
    recent: await import("../../../src/storage/recentStore"),
    wheels: await import("../../../src/storage/pluginWheelStore"),
    opfs: await import("../../../src/storage/opfsSession"),
    capabilities: await import("../../../src/runtime/demoCapabilities"),
  };
}

it("isolates existing trust, preferences, credentials and documents by build, not engine", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const stable = await loadProfile(false, "?engine=wasm64");
  expect(stable.capabilities.restrictedWasm64).toBe(false);
  stable.trust.trustPluginHash("stable.py", "old");
  stable.registry.saveRegistrySettings({
    address: "https://stable.invalid",
    token: "stable-token",
  });
  await stable.recent.recordRecent("macro", {
    id: "m",
    title: "stable",
    content: "stable",
  });
  const demo = await loadProfile(true);
  expect(demo.capabilities.restrictedWasm64).toBe(true);
  expect(demo.trust.listTrustedPlugins()).toEqual([]);
  expect(demo.registry.loadRegistrySettings()).toEqual({
    address: "",
    token: "",
  });
  expect(await demo.recent.listRecent("macro")).toEqual([]);
  expect(demo.wheels.PLUGIN_WHEEL_STORE_DIR).not.toBe(
    stable.wheels.PLUGIN_WHEEL_STORE_DIR,
  );
  expect(demo.opfs.SESSIONS_DIR).not.toBe(stable.opfs.SESSIONS_DIR);
  demo.trust.trustPluginHash("demo.py", "new");
  const fallback = await loadProfile(true, "?engine=pyodide");
  expect(fallback.capabilities.restrictedWasm64).toBe(false);
  expect(fallback.trust.isPluginHashTrusted("demo.py", "new")).toBe(true);
  fallback.registry.saveRegistrySettings({ address: "", token: "" });
  await fallback.recent.clearRecent("macro");
  expect(stable.trust.isPluginHashTrusted("demo.py", "new")).toBe(false);
  expect(stable.registry.loadRegistrySettings().token).toBe("stable-token");
  expect((await stable.recent.getRecent("macro", "m"))?.content).toBe("stable");
});

it("will not run demo cleanup from the stable build", async () => {
  await loadProfile(false);
  const { resetDemoProfile } =
    await import("../../../src/storage/resetDemoProfile");
  await expect(resetDemoProfile()).rejects.toThrow("Not a demo");
});

it("rejects warmups and direct assistant macro execution without constructing a Pyodide worker", async () => {
  await loadProfile(true);
  const worker = vi.fn();
  vi.stubGlobal("Worker", worker);
  const { MacroRuntime } = await import("../../../src/runtime/MacroRuntime");
  const { NotebookRuntime } =
    await import("../../../src/notebook/NotebookRuntime");
  const { DataLabRuntime } = await import("../../../src/runtime/runtime");
  const runtime = Reflect.construct(DataLabRuntime, [{ kind: "wasm64" }]);
  await expect(new MacroRuntime(runtime).preload()).rejects.toThrow(
    "Unavailable in WASM64",
  );
  await expect(new NotebookRuntime(runtime).preload()).rejects.toThrow(
    "Unavailable in WASM64",
  );
  await expect(runtime.runMacroCode("pass")).rejects.toThrow(
    "Unavailable in WASM64",
  );
  expect(worker).not.toHaveBeenCalled();
});
