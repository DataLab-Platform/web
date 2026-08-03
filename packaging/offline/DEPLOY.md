# DataLab Web {{VERSION}} offline deployment

This directory is a self-contained static DataLab Web application for an
intranet. A conventional HTTP server distributes the files; Python and all
scientific computations run locally in each user's browser. Workspaces and
imported data are not uploaded to the server.

## Prerequisites

- A current 64-bit Chromium-based browser (Chrome or Edge) is recommended.
- Serve the complete directory over HTTP or, preferably, HTTPS.
- Do not open `index.html` through `file://` or from a shared folder. Browser
  modules, workers, WebAssembly and local package fetches require HTTP.
- Preserve every file and subdirectory, including `pyodide/` and `wheels/`.

The application works at a server root or an arbitrary sub-path without
editing files. For example, both `https://datalab.intranet/` and
`https://applications.intranet/tools/datalab/` are valid.

## Verify the transfer

Verify the external checksum before unpacking:

```powershell
(Get-FileHash -Algorithm SHA256 datalab-web-offline-{{VERSION}}.zip).Hash
Get-Content datalab-web-offline-{{VERSION}}.zip.sha256
```

On Linux:

```bash
sha256sum -c datalab-web-offline-{{VERSION}}.zip.sha256
```

After unpacking, `SHA256SUMS` covers every packaged file except itself. The
exact DataLab Web, Python, Pyodide and Python-package versions are recorded in
`VERSION.json`.

## Server configuration

Use the matching file under `deployment-examples/` as a starting point:

- `iis-web.config`: copy as `web.config` beside `index.html`;
- `nginx.conf`: adapt the filesystem root and URL prefix;
- `apache.conf`: use in a virtual host or adapt as `.htaccess` where allowed.

Required MIME types include:

| Extension              | Content type               |
| ---------------------- | -------------------------- |
| `.wasm`                | `application/wasm`         |
| `.mjs`, `.js`          | `text/javascript`          |
| `.json`                | `application/json`         |
| `.whl`, `.zip`, `.bz2` | `application/octet-stream` |

Do not configure an SPA fallback for missing files below `pyodide/` or
`wheels/`: a missing package must return 404, not `index.html`.

## HTTPS and browser storage

HTTPS with a certificate issued by the organisation's internal CA is the fully
supported configuration. Core in-memory processing may work over HTTP, but
OPFS and other storage APIs require a secure context and are disabled when the
browser does not provide one. HDF5 export remains the durable, portable
workspace mechanism in every deployment.

Origin-scoped IndexedDB and OPFS data depends on the scheme, host and port.
Changing those values may make old browser storage inaccessible. Export HDF5
workspaces before moving users to a new origin.

## Caching

- Revalidate `index.html`, `runtime-config.json` and `VERSION.json`
  (`Cache-Control: no-cache`).
- Hashed files under `assets/` may use
  `Cache-Control: public, max-age=31536000, immutable`.
- Pyodide and wheel files may use the same immutable policy when releases are
  deployed side by side in versioned directories.
- Never replace a Pyodide lock file while retaining old package files under the
  same URLs.

## Security headers

Start with this Content Security Policy and validate it in the organisation's
browser baseline before enforcing it:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';
worker-src 'self' blob:;
connect-src 'self';
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
object-src 'none';
base-uri 'self';
```

`unsafe-eval` is required by the pinned Pyodide runtime. `blob:` permits
browser-created worker and image URLs. Extend `connect-src` only for explicit,
trusted internal services. The package contains no API key and has no public
network fallback.

## Smoke test

1. Open the deployed URL in a fresh browser profile.
2. Wait for the loading screen to disappear and the DataLab workspace to show.
3. Create a signal and an image from the **Create** menu.
4. Run one signal and one image processing action.
5. Save the workspace as HDF5, reload the page and reopen the file.
6. Open **Macros** and **Notebooks** and run a cell importing `sigima`.
7. In browser developer tools, confirm all HTTP requests target the deployment
   origin.

## Update and rollback

Deploy releases side by side, for example:

```text
/datalab-web/0.6.3/
/datalab-web/{{VERSION}}/
/datalab-web/current/
```

Verify and test the new versioned URL, then switch the stable reverse-proxy
route or alias. Keep the previous directory for immediate rollback. No database
migration is needed because the static server stores no workspace data.

## Troubleshooting

- A Pyodide error names the configured distribution, version and failed module
  URL. Request that URL directly and inspect its HTTP status.
- A response containing HTML for a `.wasm`, `.whl` or `.zip` URL indicates an
  incorrect SPA rewrite.
- `Failed to fetch dynamically imported module` usually means `.mjs` has the
  wrong MIME type or a file is missing.
- A WebAssembly compile error usually means `.wasm` has the wrong MIME type or
  a security policy blocks `wasm-unsafe-eval`.
- Compare deployed files with `SHA256SUMS` after any transfer problem.
- Consult `VERSION.json` and `THIRD_PARTY_LICENSES.md` for the exact embedded
  dependency inventory.

Cloud AI providers and links to public documentation remain optional features;
they do not run automatically and are unavailable on a disconnected network.
Configure only an approved internal AI endpoint if that feature is required.
