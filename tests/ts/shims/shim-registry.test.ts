import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHIM_REGISTRY,
  PACKAGE_VERSION_SOURCES,
  type ShimDescriptor,
} from "../../../src/runtime/shims/registry";

// tests/ts/shims/ -> repo root is three levels up.
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const RUNTIME_DIR = join(REPO_ROOT, "src", "runtime");

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

function listPyFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listPyFiles(full));
    } else if (entry.endsWith(".py")) {
      out.push(full);
    }
  }
  return out;
}

const TAG_RE = /@shim-registry:\s*([\w-]+)/g;

/**
 * This suite keeps {@link SHIM_REGISTRY}, the on-disk shim sources and the
 * sentinel markers in lockstep. It runs as part of ``npm test`` (no
 * network) and MUST fail CI when they drift — most importantly when a new
 * ``# TEMPORARY SHIM`` block is added without a registry entry.
 */
describe("shim registry anti-drift", () => {
  it("declares only known kinds and consistent version sources", () => {
    for (const shim of SHIM_REGISTRY) {
      expect(["backport", "architectural"]).toContain(shim.kind);
      expect(PACKAGE_VERSION_SOURCES[shim.targetPackage]).toBeDefined();
    }
  });

  it("has unique shim ids", () => {
    const ids = SHIM_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SHIM_REGISTRY.map((s) => [s.id, s] as const))(
    "%s: every declared file/block exists and is tagged",
    (_id, shim: ShimDescriptor) => {
      // Whole-file shims: file exists and carries the @shim-registry tag.
      for (const rel of shim.files) {
        const content = read(rel);
        expect(content, `${rel} should tag ${shim.id}`).toContain(
          `@shim-registry: ${shim.id}`,
        );
      }
      // Inline block shims: both sentinels and the tag are present.
      if (shim.block) {
        const content = read(shim.block.file);
        expect(content).toContain(shim.block.startMarker);
        expect(content).toContain(shim.block.endMarker);
        expect(content).toContain(`@shim-registry: ${shim.id}`);
      }
      // A shim must point at something.
      expect(shim.files.length > 0 || shim.block !== undefined).toBe(true);
    },
  );

  it("every @shim-registry tag on disk maps to a registry entry", () => {
    const knownIds = new Set(SHIM_REGISTRY.map((s) => s.id));
    const orphanTags: string[] = [];
    for (const file of listPyFiles(RUNTIME_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(TAG_RE)) {
        const id = match[1];
        if (!knownIds.has(id)) {
          orphanTags.push(`${file}: @shim-registry: ${id}`);
        }
      }
    }
    expect(orphanTags, "unregistered @shim-registry tags").toEqual([]);
  });

  it("every TEMPORARY SHIM block on disk is registered", () => {
    const untagged: string[] = [];
    for (const file of listPyFiles(RUNTIME_DIR)) {
      const content = readFileSync(file, "utf8");
      if (content.includes("# TEMPORARY SHIM") && !TAG_RE.test(content)) {
        untagged.push(file);
      }
      TAG_RE.lastIndex = 0; // ``test`` advances lastIndex on the /g regex.
    }
    expect(
      untagged,
      "TEMPORARY SHIM block without a @shim-registry tag",
    ).toEqual([]);
  });

  it("guidata *_shim.py files loaded by the runtime are registered", () => {
    const registeredFiles = new Set(
      SHIM_REGISTRY.flatMap((s) => s.files).map((f) => f.split("/").pop()),
    );
    for (const entry of ["runtime.ts", "macroWorker.ts"]) {
      const content = readFileSync(join(RUNTIME_DIR, entry), "utf8");
      const loaded = [...content.matchAll(/([\w]+_shim)\.py/g)].map(
        (m) => `${m[1]}.py`,
      );
      for (const name of new Set(loaded)) {
        expect(
          registeredFiles.has(name),
          `${name} loaded by ${entry} but missing from SHIM_REGISTRY`,
        ).toBe(true);
      }
    }
  });
});
