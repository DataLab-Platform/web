import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The executable Node helper intentionally has no declaration file.
import {
  collectFrontendPackages,
  createDeterministicZip,
  createOfflineRuntimeConfig,
  findForbiddenRuntimeUrls,
  sha256File,
  validateOfflineRuntimeConfig,
  validateSourceRuntimeConfig,
  writeSha256Sums,
} from "../../../scripts/offline-package-lib.mjs";

const tempDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "datalab-offline-test-"));
  tempDirectories.push(path);
  return path;
}

function sourceConfig(): Record<string, any> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "public", "runtime-config.json"), "utf8"),
  );
}

afterEach(() => {
  for (const path of tempDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("offline package builder", () => {
  it("inventories the exact production frontend closure and notices", () => {
    const packages = collectFrontendPackages(process.cwd());

    expect(packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@codemirror/state",
          version: "6.6.0",
          license: "MIT",
        }),
        expect.objectContaining({
          name: "react",
          version: "18.3.1",
          license: "MIT",
          sourceUrl: expect.stringContaining("github.com/facebook/react"),
          notices: expect.arrayContaining([
            expect.objectContaining({ name: "LICENSE" }),
          ]),
        }),
      ]),
    );
    expect(
      packages.some(
        ({ name }: { name: string }) => name === "@playwright/test",
      ),
    ).toBe(false);
  });

  it("turns the exact CDN manifest into deployment-relative local assets", () => {
    const local = createOfflineRuntimeConfig(sourceConfig());

    expect(() => validateOfflineRuntimeConfig(local)).not.toThrow();
    expect(local).toMatchObject({
      distribution: "local",
      pyodideIndexUrl: "./pyodide/",
      allowPublicNetwork: false,
    });
    expect(local.pythonWheels).toHaveLength(5);
    expect(
      local.pythonWheels.every(({ url }: { url: string }) =>
        url.startsWith("./wheels/"),
      ),
    ).toBe(true);
    expect(JSON.stringify(local)).not.toMatch(/https?:\/\//);
  });

  it("rejects an incomplete package closure", () => {
    const config = sourceConfig();
    config.pyodidePackages.notebook = config.pyodidePackages.notebook.filter(
      (name: string) => name !== "scikit-image",
    );

    expect(() => validateSourceRuntimeConfig(config)).toThrow(
      /notebook.*scikit-image/,
    );
  });

  it("finds forbidden package hosts in executable assets", () => {
    const stage = temporaryDirectory();
    mkdirSync(join(stage, "assets"));
    writeFileSync(join(stage, "index.html"), "<main>DataLab</main>");
    writeFileSync(
      join(stage, "assets", "app.js"),
      [
        'fetch("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs")',
        'fetch("https://github.com/example/runtime/releases/latest")',
        'const source = "https://github.com/cure53/DOMPurify"',
      ].join(";"),
    );

    expect(findForbiddenRuntimeUrls(stage)).toEqual([
      "assets/app.js: https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs",
      "assets/app.js: https://github.com/example/runtime/releases/latest",
    ]);
  });

  it("writes internal checksums and deterministic ZIP bytes", async () => {
    const root = temporaryDirectory();
    const stage = join(root, "stage");
    mkdirSync(join(stage, "assets"), { recursive: true });
    writeFileSync(join(stage, "index.html"), "<main>DataLab</main>\n");
    writeFileSync(join(stage, "assets", "app.js"), "export {};\n");
    await writeSha256Sums(stage);

    const sums = readFileSync(join(stage, "SHA256SUMS"), "utf8");
    expect(sums).toContain("  assets/app.js");
    expect(sums).toContain("  index.html");
    expect(sums).not.toContain("  SHA256SUMS");

    const first = join(root, "first.zip");
    const second = join(root, "second.zip");
    await createDeterministicZip(stage, "datalab-web-offline-test", first);
    await createDeterministicZip(stage, "datalab-web-offline-test", second);
    expect(await sha256File(first)).toBe(await sha256File(second));
  });
});
