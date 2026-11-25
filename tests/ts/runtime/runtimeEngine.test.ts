import { describe, expect, it } from "vitest";
import { selectEngine } from "../../../src/runtime/runtimeEngine";

describe("experimental runtime", () => {
  it("never selects wasm64 in the stable build", () => {
    expect(selectEngine(false, "?engine=wasm64", "main")).toEqual({
      engine: "pyodide",
      placement: "main",
    });
  });
  it("overrides stale main-thread preferences but not explicit requests", () => {
    expect(selectEngine(true, "", "main")).toEqual({
      engine: "wasm64",
      placement: "worker",
    });
    expect(selectEngine(true, "?runtime=main", "main").error).toMatch(
      /requires a worker/,
    );
    expect(selectEngine(true, "?engine=pyodide&runtime=main", "main")).toEqual({
      engine: "pyodide",
      placement: "main",
    });
  });
});
