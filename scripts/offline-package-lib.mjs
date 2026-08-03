import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import AdmZip from "adm-zip";
import { ZipArchive } from "archiver";

export const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

export const PYODIDE_DISTRIBUTION = Object.freeze({
  version: "0.26.4",
  filename: "pyodide-0.26.4.tar.bz2",
  url: "https://github.com/pyodide/pyodide/releases/download/0.26.4/pyodide-0.26.4.tar.bz2",
  size: 297704224,
  sha256: "f6ee209650babf1669f1a9560a5f89f66c0d38aacc2d5b8cd8b4dd6a7537cba9",
});

const REQUIRED_WHEELS = ["guidata", "makefun", "qtpy", "sigima", "tifffile"];

const REQUIRED_PYODIDE_PACKAGES = [
  "h5py",
  "micropip",
  "numpy",
  "packaging",
  "pandas",
  "pywavelets",
  "requests",
  "scikit-image",
  "scipy",
  "typing-extensions",
];

const FORBIDDEN_PUBLIC_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "files.pythonhosted.org",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "github.com",
  "pypi.org",
  "raw.githubusercontent.com",
]);

const ALLOWED_USER_INITIATED_URLS = [
  "https://github.com/DataLab-Platform/",
  "https://github.com/cure53/DOMPurify",
  "https://github.com/d3/d3-format/",
  "https://github.com/d3/d3-time-format/",
  "https://github.com/mapbox/mapbox-gl-js/issues/2907",
  "https://github.com/markedjs/marked",
  "https://github.com/mikolalysenko/glsl-read-float/",
];

const FIXED_ARCHIVE_DATE = new Date("2000-01-01T00:00:00.000Z");

function fail(message) {
  throw new Error(`[offline-package] ${message}`);
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function portableRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertFileIntegrity(path, expectedSha256, expectedSize) {
  if (!existsSync(path)) fail(`missing file: ${path}`);
  if (expectedSize !== undefined && statSync(path).size !== expectedSize) {
    fail(`unexpected size for ${path}`);
  }
  const actual = await sha256File(path);
  if (actual !== expectedSha256) {
    fail(
      `SHA-256 mismatch for ${path}: expected ${expectedSha256}, got ${actual}`,
    );
  }
}

export async function downloadVerified(
  url,
  destination,
  expectedSha256,
  expectedSize,
) {
  if (existsSync(destination)) {
    try {
      await assertFileIntegrity(destination, expectedSha256, expectedSize);
      return destination;
    } catch {
      rmSync(destination, { force: true });
    }
  }

  mkdirSync(dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  rmSync(partial, { force: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    fail(`download failed (${response.status}) for ${url}`);
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await assertFileIntegrity(partial, expectedSha256, expectedSize);
    renameSync(partial, destination);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  return destination;
}

function wheelFilename(wheel) {
  let filename;
  try {
    filename = basename(new URL(wheel.url).pathname);
  } catch {
    fail(`invalid source URL for ${wheel.name}: ${wheel.url}`);
  }
  if (!filename.endsWith(".whl") || filename !== decodeURIComponent(filename)) {
    fail(`invalid wheel filename for ${wheel.name}: ${filename}`);
  }
  return filename;
}

export function validateSourceRuntimeConfig(config) {
  if (config.schemaVersion !== 1 || config.distribution !== "cdn") {
    fail("public/runtime-config.json must be a schema-1 CDN distribution");
  }
  if (config.pyodideVersion !== PYODIDE_DISTRIBUTION.version) {
    fail("runtime and offline Pyodide versions disagree");
  }
  if (!config.allowPublicNetwork) {
    fail("the default CDN distribution must allow dependency downloads");
  }

  const names = config.pythonWheels
    .map((wheel) => wheel.name.toLowerCase())
    .sort();
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_WHEELS)) {
    fail(`wheel closure must be exactly: ${REQUIRED_WHEELS.join(", ")}`);
  }
  for (const wheel of config.pythonWheels) {
    if (!/^[a-f0-9]{64}$/.test(wheel.sha256)) {
      fail(`invalid SHA-256 for ${wheel.name}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.+!-]*$/.test(wheel.version)) {
      fail(`unconstrained version for ${wheel.name}`);
    }
    wheelFilename(wheel);
  }

  for (const runtimeKind of ["main", "macro", "notebook"]) {
    const packages = new Set(config.pyodidePackages?.[runtimeKind]);
    for (const packageName of REQUIRED_PYODIDE_PACKAGES) {
      if (!packages.has(packageName)) {
        fail(
          `${runtimeKind} runtime is missing Pyodide package ${packageName}`,
        );
      }
    }
  }
}

export function createOfflineRuntimeConfig(sourceConfig) {
  validateSourceRuntimeConfig(sourceConfig);
  return {
    ...sourceConfig,
    distribution: "local",
    pyodideIndexUrl: "./pyodide/",
    pythonWheels: sourceConfig.pythonWheels.map((wheel) => ({
      ...wheel,
      url: `./wheels/${wheelFilename(wheel)}`,
    })),
    allowPublicNetwork: false,
  };
}

export function validateOfflineRuntimeConfig(config) {
  if (config.distribution !== "local" || config.allowPublicNetwork !== false) {
    fail("offline runtime configuration must disable public network access");
  }
  if (config.pyodideIndexUrl !== "./pyodide/") {
    fail("offline Pyodide index must be deployment-relative");
  }
  for (const wheel of config.pythonWheels) {
    if (!wheel.url.startsWith("./wheels/") || !wheel.url.endsWith(".whl")) {
      fail(`offline wheel path is not package-relative: ${wheel.url}`);
    }
  }
  const serialized = JSON.stringify(config);
  if (/https?:\/\//i.test(serialized)) {
    fail("offline runtime configuration contains a public URL");
  }
}

function parseWheelMetadata(wheelPath, includeNotices = false) {
  const zip = new AdmZip(wheelPath);
  const entries = zip.getEntries();
  const metadataEntry = entries.find((entry) =>
    /\.dist-info\/METADATA$/i.test(entry.entryName),
  );
  if (!metadataEntry) fail(`wheel has no METADATA: ${wheelPath}`);
  const source = metadataEntry.getData().toString("utf8");
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
  }
  const projectUrls = values.get("Project-URL") ?? [];
  const sourceUrl =
    projectUrls
      .find((value) => /^(Homepage|Source|Github),/i.test(value))
      ?.split(/,\s*/, 2)[1] ??
    values.get("Home-page")?.[0] ??
    "Not declared";
  let license =
    values.get("License-Expression")?.[0] ?? values.get("License")?.[0] ?? "";
  if (!license || license.toUpperCase() === "UNKNOWN") {
    license =
      values
        .get("Classifier")
        ?.find((value) => value.startsWith("License ::"))
        ?.replace(/^License :: (OSI Approved :: )?/, "") ?? "Not declared";
  }
  const notices = includeNotices
    ? entries
        .filter(
          (entry) =>
            !entry.isDirectory &&
            /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)(\.[^/]*)?$/i.test(
              entry.entryName,
            ),
        )
        .map((entry) => ({
          name: entry.entryName,
          text: entry.getData().toString("utf8").trim(),
        }))
    : [];
  return {
    name: values.get("Name")?.[0] ?? "Unknown",
    version: values.get("Version")?.[0] ?? "Unknown",
    license,
    sourceUrl,
    notices,
  };
}

async function verifyPyodideDistribution(pyodideDirectory) {
  for (const filename of [
    "pyodide.mjs",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ]) {
    if (!existsSync(join(pyodideDirectory, filename))) {
      fail(`complete Pyodide archive is missing ${filename}`);
    }
  }
  const lock = json(join(pyodideDirectory, "pyodide-lock.json"));
  if (lock.info?.version !== PYODIDE_DISTRIBUTION.version) {
    fail(`unexpected Pyodide lock version: ${lock.info?.version}`);
  }
  for (const entry of Object.values(lock.packages)) {
    if (!entry.file_name) continue;
    await assertFileIntegrity(
      join(pyodideDirectory, entry.file_name),
      entry.sha256,
    );
  }
  return lock;
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function npmLicense(metadata, lockEntry) {
  const declared = metadata.license ?? metadata.licenses ?? lockEntry.license;
  if (typeof declared === "string" && declared.trim()) return declared;
  if (declared && typeof declared.type === "string") return declared.type;
  if (Array.isArray(declared)) {
    const values = declared
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter(Boolean);
    if (values.length) return values.join(" OR ");
  }
  return "Not declared";
}

function npmSource(metadata, lockEntry) {
  const repository = metadata.repository;
  const source =
    (typeof repository === "string" ? repository : repository?.url) ??
    metadata.homepage ??
    lockEntry.resolved ??
    "Not declared";
  return source.replace(/^git\+/, "");
}

/** Collect the exact production npm closure and root license notices. */
export function collectFrontendPackages(root = ROOT) {
  const lock = json(join(root, "package-lock.json"));
  if (lock.lockfileVersion !== 3 || typeof lock.packages !== "object") {
    fail("package-lock.json must use npm lockfile version 3");
  }
  const records = new Map();
  for (const [packagePath, lockEntry] of Object.entries(lock.packages)) {
    if (
      !packagePath.startsWith("node_modules/") ||
      lockEntry.dev === true ||
      typeof lockEntry.version !== "string"
    ) {
      continue;
    }
    const directory = join(root, ...packagePath.split("/"));
    const metadataPath = join(directory, "package.json");
    const metadata = existsSync(metadataPath) ? json(metadataPath) : {};
    const name =
      metadata.name ?? packagePath.split("node_modules/").at(-1) ?? packagePath;
    const version = metadata.version ?? lockEntry.version;
    if (version !== lockEntry.version) {
      fail(`npm metadata disagrees with lockfile for ${name}`);
    }
    const notices = existsSync(directory)
      ? readdirSync(directory, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() &&
              /^(LICENSE|LICENCE|COPYING|NOTICE)(\.[^/]*)?$/i.test(entry.name),
          )
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => ({
            name: entry.name,
            text: readFileSync(join(directory, entry.name), "utf8").trim(),
          }))
      : [];
    const key = `${name}\0${version}`;
    if (!records.has(key)) {
      records.set(key, {
        name,
        version,
        license: npmLicense(metadata, lockEntry),
        sourceUrl: npmSource(metadata, lockEntry),
        notices,
      });
    }
  }
  return Array.from(records.values()).sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version),
  );
}

function generateThirdPartyLicenses(
  lock,
  pyodideDirectory,
  wheelRecords,
  frontendRecords,
) {
  const lines = [
    "# Third-party licenses",
    "",
    "This inventory is generated from the metadata embedded in the exact",
    "archives distributed with this package. `Not declared` means the official",
    "runtime archive did not expose a license identifier; no value is guessed.",
    "",
    "## Frontend production dependency closure",
    "",
    "| Component | Version | License | Source |",
    "| --- | --- | --- | --- |",
  ];
  for (const dependency of frontendRecords) {
    lines.push(
      `| ${markdownCell(dependency.name)} | ${markdownCell(dependency.version)} | ${markdownCell(dependency.license)} | ${markdownCell(dependency.sourceUrl)} |`,
    );
  }

  lines.push(
    "",
    "## Runtime distributions",
    "",
    "| Component | Version | License | Source |",
    "| --- | --- | --- | --- |",
    `| Pyodide | ${lock.info.version} | MPL-2.0 | https://github.com/pyodide/pyodide |`,
    "",
    "## Additional Python wheels",
    "",
    "| Component | Version | License | Source | SHA-256 |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const wheel of wheelRecords) {
    lines.push(
      `| ${markdownCell(wheel.metadata.name)} | ${markdownCell(wheel.metadata.version)} | ${markdownCell(wheel.metadata.license)} | ${markdownCell(wheel.metadata.sourceUrl)} | \`${wheel.sha256}\` |`,
    );
  }

  lines.push(
    "",
    "## Complete Pyodide package repository",
    "",
    "| Component | Version | Type | License declared in wheel | SHA-256 |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [name, entry] of Object.entries(lock.packages).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    let license = "Not declared";
    const packagePath = entry.file_name
      ? join(pyodideDirectory, entry.file_name)
      : null;
    if (packagePath?.endsWith(".whl")) {
      try {
        license = parseWheelMetadata(packagePath).license;
      } catch {
        license = "Not declared";
      }
    }
    lines.push(
      `| ${markdownCell(name)} | ${markdownCell(entry.version)} | ${markdownCell(entry.package_type)} | ${markdownCell(license)} | \`${entry.sha256}\` |`,
    );
  }

  const notices = [
    ...frontendRecords.flatMap((dependency) =>
      dependency.notices.map((notice) => ({
        component: `${dependency.name} ${dependency.version}`,
        ...notice,
      })),
    ),
    ...wheelRecords.flatMap((wheel) =>
      wheel.metadata.notices.map((notice) => ({
        component: `${wheel.metadata.name} ${wheel.metadata.version}`,
        ...notice,
      })),
    ),
  ];
  if (notices.length) {
    lines.push("", "## Bundled notices", "");
    for (const notice of notices) {
      lines.push(
        `### ${notice.component}: ${notice.name}`,
        "",
        "```text",
        notice.text,
        "```",
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function findForbiddenRuntimeUrls(stageDirectory) {
  const roots = [
    join(stageDirectory, "index.html"),
    join(stageDirectory, "assets"),
  ];
  const candidates = roots.flatMap((root) => {
    if (!existsSync(root)) return [];
    return statSync(root).isDirectory() ? listFiles(root) : [root];
  });
  const findings = [];
  for (const path of candidates) {
    if (!/\.(?:css|html|js|mjs)$/i.test(path)) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/https?:\/\/[^\s"'`<>)\\]+/gi)) {
      const href = match[0];
      let host;
      try {
        host = new URL(href).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (!FORBIDDEN_PUBLIC_HOSTS.has(host)) continue;
      if (
        ALLOWED_USER_INITIATED_URLS.some((prefix) => href.startsWith(prefix))
      ) {
        continue;
      }
      findings.push(`${portableRelative(stageDirectory, path)}: ${href}`);
    }
  }
  return findings.sort();
}

export async function writeSha256Sums(stageDirectory) {
  const sumsPath = join(stageDirectory, "SHA256SUMS");
  const files = listFiles(stageDirectory).filter((path) => path !== sumsPath);
  const lines = [];
  for (const path of files) {
    lines.push(
      `${await sha256File(path)}  ${portableRelative(stageDirectory, path)}`,
    );
  }
  writeFileSync(sumsPath, `${lines.join("\n")}\n`);
  return sumsPath;
}

export async function stageOfflinePackage({
  root = ROOT,
  stageDirectory,
  cacheDirectory = process.env.DATALAB_OFFLINE_CACHE ??
    join(root, ".cache", "offline"),
  log = console.log,
} = {}) {
  const pkg = json(join(root, "package.json"));
  const folderName = `datalab-web-offline-${pkg.version}`;
  const stage = stageDirectory ?? join(root, "release", folderName);
  const dist = join(root, "dist");
  if (!existsSync(dist)) fail("dist/ not found; run `npm run build` first");

  const sourceConfig = json(join(root, "public", "runtime-config.json"));
  const frontendRecords = collectFrontendPackages(root);
  const runtimeConfig = createOfflineRuntimeConfig(sourceConfig);
  validateOfflineRuntimeConfig(runtimeConfig);

  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(dist, stage, { recursive: true });

  log(`[offline-package] acquiring Pyodide ${PYODIDE_DISTRIBUTION.version}`);
  const pyodideArchive = await downloadVerified(
    PYODIDE_DISTRIBUTION.url,
    join(cacheDirectory, PYODIDE_DISTRIBUTION.filename),
    PYODIDE_DISTRIBUTION.sha256,
    PYODIDE_DISTRIBUTION.size,
  );
  execFileSync("tar", ["-xjf", pyodideArchive, "-C", stage], {
    stdio: "inherit",
  });
  const pyodideDirectory = join(stage, "pyodide");
  const lock = await verifyPyodideDistribution(pyodideDirectory);

  const wheelsDirectory = join(stage, "wheels");
  mkdirSync(wheelsDirectory, { recursive: true });
  const wheelRecords = [];
  for (const wheel of sourceConfig.pythonWheels) {
    const filename = wheelFilename(wheel);
    const cached = await downloadVerified(
      wheel.url,
      join(cacheDirectory, filename),
      wheel.sha256,
    );
    const destination = join(wheelsDirectory, filename);
    cpSync(cached, destination);
    const metadata = parseWheelMetadata(destination, true);
    if (
      metadata.name.toLowerCase() !== wheel.name.toLowerCase() ||
      metadata.version !== wheel.version
    ) {
      fail(`wheel metadata disagrees with manifest for ${wheel.name}`);
    }
    wheelRecords.push({ ...wheel, filename, metadata });
  }

  writeFileSync(
    join(stage, "runtime-config.json"),
    `${JSON.stringify(runtimeConfig, null, 2)}\n`,
  );
  const versionManifest = {
    schemaVersion: 1,
    datalabWeb: pkg.version,
    python: lock.info.python,
    pyodide: {
      version: lock.info.version,
      abiVersion: lock.info.abi_version,
      platform: lock.info.platform,
      architecture: lock.info.arch,
      completeDistribution: true,
      packageCount: Object.keys(lock.packages).length,
      archive: {
        filename: PYODIDE_DISTRIBUTION.filename,
        sha256: PYODIDE_DISTRIBUTION.sha256,
      },
    },
    runtimePackages: runtimeConfig.pyodidePackages,
    frontendPackages: frontendRecords.map(
      ({ name, version, license, sourceUrl }) => ({
        name,
        version,
        license,
        source: sourceUrl,
      }),
    ),
    pythonWheels: Object.fromEntries(
      wheelRecords.map((wheel) => [
        wheel.name,
        {
          version: wheel.version,
          filename: wheel.filename,
          sha256: wheel.sha256,
          license: wheel.metadata.license,
          source: wheel.metadata.sourceUrl,
        },
      ]),
    ),
  };
  writeFileSync(
    join(stage, "VERSION.json"),
    `${JSON.stringify(versionManifest, null, 2)}\n`,
  );
  writeFileSync(
    join(stage, "THIRD_PARTY_LICENSES.md"),
    generateThirdPartyLicenses(
      lock,
      pyodideDirectory,
      wheelRecords,
      frontendRecords,
    ),
  );

  const packagingDirectory = join(root, "packaging", "offline");
  const deployTemplate = readFileSync(
    join(packagingDirectory, "DEPLOY.md"),
    "utf8",
  );
  writeFileSync(
    join(stage, "DEPLOY.md"),
    deployTemplate.replaceAll("{{VERSION}}", pkg.version),
  );
  cpSync(
    join(packagingDirectory, "deployment-examples"),
    join(stage, "deployment-examples"),
    { recursive: true },
  );

  const forbiddenUrls = findForbiddenRuntimeUrls(stage);
  if (forbiddenUrls.length) {
    fail(`forbidden public runtime URLs found:\n${forbiddenUrls.join("\n")}`);
  }
  await writeSha256Sums(stage);
  log(`[offline-package] staged ${folderName}`);
  return { folderName, stage, versionManifest };
}

export async function createDeterministicZip(stage, folderName, zipPath) {
  mkdirSync(dirname(zipPath), { recursive: true });
  rmSync(zipPath, { force: true });
  await new Promise((resolvePromise, rejectPromise) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", resolvePromise);
    output.on("error", rejectPromise);
    archive.on("error", rejectPromise);
    archive.pipe(output);
    for (const path of listFiles(stage)) {
      archive.append(createReadStream(path), {
        name: `${folderName}/${portableRelative(stage, path)}`,
        date: FIXED_ARCHIVE_DATE,
        mode: 0o644,
      });
    }
    void archive.finalize();
  });
  return zipPath;
}

export async function packOfflinePackage(options = {}) {
  const root = options.root ?? ROOT;
  const release = join(root, "release");
  mkdirSync(release, { recursive: true });
  const { folderName, stage, versionManifest } = await stageOfflinePackage({
    ...options,
    root,
  });
  const zipPath = join(release, `${folderName}.zip`);
  await createDeterministicZip(stage, folderName, zipPath);
  const zipSha256 = await sha256File(zipPath);
  writeFileSync(`${zipPath}.sha256`, `${zipSha256}  ${basename(zipPath)}\n`);
  rmSync(stage, { recursive: true, force: true });
  return { zipPath, zipSha256, versionManifest };
}
