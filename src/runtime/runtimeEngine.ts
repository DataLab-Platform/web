import type { RuntimeMode } from "./runtimeMode";

export type Engine = "pyodide" | "wasm64";
export interface EngineLaunch {
  engine: Engine;
  placement: RuntimeMode;
  error?: string;
}

export function selectEngine(
  demo: boolean,
  search: string,
  preferred: RuntimeMode,
): EngineLaunch {
  const query = new URLSearchParams(search);
  const engine = query.get("engine");
  if (!demo || engine === "pyodide")
    return { engine: "pyodide", placement: preferred };
  if (engine !== null && engine !== "wasm64")
    return {
      engine: "wasm64",
      placement: "worker",
      error: "Unknown experimental engine.",
    };
  if (query.get("runtime")?.toLowerCase() === "main")
    return {
      engine: "wasm64",
      placement: "worker",
      error: "WASM64 requires a worker. Remove ?runtime=main.",
    };
  return { engine: "wasm64", placement: "worker" };
}
