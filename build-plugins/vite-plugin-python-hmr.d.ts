import type { Plugin } from "vite";
/**
 * Vite plugin: hot-reload Python files into a live Pyodide instance.
 *
 * Without this plugin, ``import "./bootstrap.py?raw"`` is treated as a
 * static asset by Vite — any change triggers a *full page reload*, which
 * means re-downloading and re-initialising Pyodide (~30 s).  This plugin
 * intercepts changes to ``.py`` files under ``src/`` and pushes a custom
 * HMR event with the new source to the browser, where the client listens
 * via ``import.meta.hot.on("datalab-web:python-update", ...)`` and re-runs
 * the source against the existing Pyodide runtime.
 */
export declare function pythonHmr(): Plugin;
