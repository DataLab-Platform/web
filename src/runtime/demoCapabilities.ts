/** UI and secondary-worker capabilities are fixed for the page lifetime.
 * Do not infer the engine from a worker bundle's URL (no page search). */
export const restrictedWasm64 =
  import.meta.env.VITE_WASM64_DEMO === "1" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("engine") !== "pyodide";
