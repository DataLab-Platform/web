#!/usr/bin/env node
/**
 * Package the built DataLab-Web bundle (``dist/``) plus a minimal
 * deployment README into a versioned ``.tgz`` tarball under
 * ``release/``.
 *
 * The tarball layout matches what an integrator drops into a static
 * file server (or copies into their own application's ``public/`` /
 * ``assets/`` folder):
 *
 *   datalab-web-<version>/
 *     index.html
 *     assets/...
 *     ...
 *     DEPLOY.md   ← short hosting guide added by this script
 *
 * Usage: ``node scripts/pack-app.mjs`` (run automatically by the
 * ``app:pack`` npm script after ``npm run build``).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const DIST = join(ROOT, "dist");
const RELEASE = join(ROOT, "release");

if (!existsSync(DIST)) {
  console.error(
    "[pack-app] dist/ not found — run `npm run build` before `npm run app:pack`.",
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const version = pkg.version;
const folderName = `datalab-web-${version}`;
const tarballName = `${folderName}.tgz`;

mkdirSync(RELEASE, { recursive: true });

// Stage dist/ under release/<folderName>/ so the tarball expands to a
// self-contained, versioned directory.
const stage = join(RELEASE, folderName);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// ``tar`` (bsdtar on Windows, GNU tar on Linux/macOS) is portable and
// handles both directory copy and gzip; use it to stage dist/ into the
// release folder, then re-pack the staged folder as the final tarball.
execFileSync("tar", ["-cf", join(RELEASE, ".stage.tar"), "-C", DIST, "."], {
  stdio: "inherit",
});
execFileSync("tar", ["-xf", join(RELEASE, ".stage.tar"), "-C", stage], {
  stdio: "inherit",
});
rmSync(join(RELEASE, ".stage.tar"));

// Generate a short deployment README inside the tarball.
const deployDoc = `# DataLab-Web — Deployment

This bundle is the static build output of DataLab-Web ${version}.
Drop the contents of this directory under your web server to serve
the application.

## Hosting

- Serve the entire directory from any HTTP server.
- The bundle uses **relative URLs** (\`<base href="./">\`), so it works
  unchanged at the site root or under any sub-path
  (e.g. \`/datalab-web/\`).

## Embedding in another web application

To embed DataLab-Web in an iframe and drive it remotely from the host
page, append the host origin to the iframe URL:

\`\`\`html
<iframe
  src="/datalab-web/index.html?allowedOrigins=https%3A%2F%2Fmy-app.example.com"
  allow="cross-origin-isolated"
></iframe>
\`\`\`

Multiple origins can be passed comma-separated. Use \`*\` only for
local development.

Pair this bundle with the \`@datalab-platform/web-sdk\` npm package
(distributed as a separate \`.tgz\`) on the host side — see its
README for usage.

## Recommended HTTP headers

- \`Content-Type\` is auto-detected for static files.
- For best Pyodide performance, consider \`Cache-Control: public, max-age=31536000, immutable\`
  on hashed asset filenames under \`assets/\`.
- No \`COEP\`/\`COOP\` are strictly required, but \`SharedArrayBuffer\`-based
  optimisations may benefit from them on large workloads.

## Compatibility

This bundle implements wire-protocol \`MAJOR\` 1. Use a SDK release
whose \`SUPPORTED_PROTOCOL_MAJOR\` matches.
`;
writeFileSync(join(stage, "DEPLOY.md"), deployDoc);

// Final tarball.
const tarball = join(RELEASE, tarballName);
rmSync(tarball, { force: true });
execFileSync("tar", ["-czf", tarball, "-C", RELEASE, folderName], {
  stdio: "inherit",
});

// Tidy up the staged directory; keep only the .tgz.
rmSync(stage, { recursive: true, force: true });

console.log(`[pack-app] wrote ${tarball}`);
