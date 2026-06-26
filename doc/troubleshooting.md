# Troubleshooting

## Microsoft Edge: slow first load (several minutes instead of ~30 s)

If the first load takes several minutes instead of ~30 s on Microsoft Edge, Edge's _Enhance your security on the web_ setting is disabling the WebAssembly JIT compiler on this site. Microsoft [documents this behaviour and explicitly recommends the workaround](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-browse-safer) — quoting the page:

> Developers should be aware that the WebAssembly (WASM) interpreter running in enhanced security mode might not yield the expected level of performance. We recommend adding your site as an exception to opt-out of enhanced security mode for site users.

To add the exception: open `edge://settings/privacy` → _Security_ → _Manage enhanced security for sites_ → under _Never use enhanced security for these sites_, click _Add a site_ and enter `https://datalab-platform.com` (or your deployment URL). Reload the page; load time drops back to ~30 s. Chrome, Firefox and Safari are not affected.

## Force the in-thread runtime (`?runtime=main`)

By default DataLab-Web runs its Pyodide runtime in a Dedicated Web Worker, which keeps the UI responsive during heavy work. If you suspect a worker-specific problem (the app hangs at boot, a processing never returns, or you are debugging the runtime), you can fall back to the original in-thread runtime by appending `?runtime=main` to the URL — for example `https://datalab-platform.com/?runtime=main`. The choice is also honoured from `localStorage["datalab-web:runtime"] = "main"` and, at build time, from `VITE_RUNTIME_WORKER=0`. Both topologies expose the exact same features; the in-thread mode is a backup, not the nominal configuration. Use `?runtime=worker` to force the default back.
