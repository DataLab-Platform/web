// Single canonical declaration for the Pyodide global injected by the
// <script> tag in index.html and bench/index.html. Multiple modules
// (`src/runtime/runtime.ts`, `src/aiassistant/providers/local/bench/macroValidator.ts`)
// reference `window.loadPyodide` — declaring it in each one with a
// different return type triggers TS2717 modifier-mismatch errors.

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<unknown>;
  }
}

export {};
