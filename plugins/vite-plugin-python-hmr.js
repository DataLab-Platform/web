import { readFile } from "node:fs/promises";
import { relative } from "node:path";
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
export function pythonHmr() {
    return {
        name: "datalab-web:python-hmr",
        async handleHotUpdate(ctx) {
            if (!ctx.file.endsWith(".py"))
                return;
            const root = ctx.server.config.root;
            const relPath = relative(root, ctx.file).replace(/\\/g, "/");
            const source = await readFile(ctx.file, "utf-8");
            ctx.server.ws.send({
                type: "custom",
                event: "datalab-web:python-update",
                data: { path: relPath, source },
            });
            // Returning [] tells Vite "I handled it — do nothing else, especially
            // do NOT trigger a full reload".
            return [];
        },
    };
}
