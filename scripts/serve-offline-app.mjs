#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

import { ROOT, stageOfflinePackage } from "./offline-package-lib.mjs";

const host = process.env.OFFLINE_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.OFFLINE_PORT ?? "4174", 10);
const rawPrefix = process.env.OFFLINE_BASE_PATH ?? "/tools/datalab/";
const prefix = `/${rawPrefix.replace(/^\/+|\/+$/g, "")}/`;
const stageParent = join(ROOT, ".cache", "offline-e2e");

const MIME_TYPES = new Map([
  [".bz2", "application/octet-stream"],
  [".css", "text/css; charset=utf-8"],
  [".data", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".whl", "application/octet-stream"],
  [".zip", "application/octet-stream"],
]);

const packageInfo = JSON.parse(
  await import("node:fs").then(({ readFileSync }) =>
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ),
);
const folderName = `datalab-web-offline-${packageInfo.version}`;
const stage = join(stageParent, folderName);
await stageOfflinePackage({ stageDirectory: stage });

function resolveRequestPath(pathname) {
  if (!pathname.startsWith(prefix)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  const relativePath = decoded === "" ? "index.html" : normalize(decoded);
  const candidate = resolve(stage, relativePath);
  const withinStage = relative(stage, candidate);
  if (
    withinStage === "" ||
    withinStage === ".." ||
    withinStage.startsWith(`..${sep}`)
  ) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    return join(candidate, "index.html");
  }
  return candidate;
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const path = resolveRequestPath(requestUrl.pathname);
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }

  const filename = relative(stage, path).split(sep).join("/");
  const noCache = [
    "index.html",
    "runtime-config.json",
    "VERSION.json",
  ].includes(filename);
  response.writeHead(200, {
    "Cache-Control": noCache
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "Content-Type":
      MIME_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(path).pipe(response);
});

server.listen(port, host, () => {
  console.log(`[offline-server] http://${host}:${port}${prefix}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
