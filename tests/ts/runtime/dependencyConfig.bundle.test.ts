// @vitest-environment node

import { fileURLToPath } from "node:url";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import capsuleDependency from "../../../datalab-capsule-dependency.json";
import guidataDependency from "../../../guidata-dependency.json";
import sigimaDependency from "../../../sigima-dependency.json";

const markers = {
  sigima: "__SIGIMA_DEVELOPMENT_OVERRIDE__",
  guidata: "__GUIDATA_DEVELOPMENT_OVERRIDE__",
  capsule: "__CAPSULE_DEVELOPMENT_OVERRIDE__",
};

async function bundleDependencyConfig(
  mode: string,
  capsuleRequirement?: string | null,
): Promise<{ code: string; sourceMap: string }> {
  const result = await build({
    configFile: false,
    envFile: false,
    mode,
    logLevel: "silent",
    plugins:
      capsuleRequirement === undefined
        ? []
        : [
            {
              name: "test-capsule-dependency",
              enforce: "pre",
              resolveId(source) {
                if (source.endsWith("/datalab-capsule-dependency.json")) {
                  return "\0test-capsule-dependency";
                }
              },
              load(id) {
                if (id === "\0test-capsule-dependency") {
                  return `export default ${JSON.stringify({
                    publishedRequirement: capsuleRequirement,
                  })};`;
                }
              },
            },
          ],
    define: {
      "import.meta.env.VITE_SIGIMA_INSTALL_SPEC": JSON.stringify(
        markers.sigima,
      ),
      "import.meta.env.VITE_GUIDATA_INSTALL_SPEC": JSON.stringify(
        markers.guidata,
      ),
      "import.meta.env.VITE_DATALAB_CAPSULE_INSTALL_SPEC": JSON.stringify(
        markers.capsule,
      ),
    },
    build: {
      write: false,
      minify: "esbuild",
      sourcemap: true,
      lib: {
        entry: fileURLToPath(
          new URL("../../../src/runtime/dependencyConfig.ts", import.meta.url),
        ),
        formats: ["es"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  if (outputs.length !== 1 || !("output" in outputs[0])) {
    throw new Error("Expected one dependency configuration bundle");
  }
  const chunks = outputs[0].output.filter((item) => item.type === "chunk");
  expect(chunks).toHaveLength(1);
  const { code, map } = chunks[0];
  if (!map) throw new Error("Expected a dependency configuration source map");
  return { code, sourceMap: map.toString() };
}

async function loadBundle(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(/* @vite-ignore */ url);
}

describe("dependency configuration bundles", () => {
  it("keeps development overrides in development builds", async () => {
    const { code } = await bundleDependencyConfig("development");
    for (const marker of Object.values(markers)) {
      expect(code).toContain(marker);
    }
    const config = await loadBundle(code);
    expect(config.SIGIMA_INSTALL_SPEC).toBe(markers.sigima);
    expect(config.GUIDATA_INSTALL_SPEC).toBe(markers.guidata);
    expect(config.DATALAB_CAPSULE_INSTALL_SPEC).toBe(markers.capsule);
  });

  it("excludes development override values from release builds", async () => {
    const { code, sourceMap } = await bundleDependencyConfig("release");
    for (const marker of Object.values(markers)) {
      expect(code).not.toContain(marker);
      expect(sourceMap).not.toContain(marker);
    }
    expect(code).toContain(sigimaDependency.publishedRequirement);
    expect(code).toContain(guidataDependency.publishedRequirement);
    if (capsuleDependency.publishedRequirement !== null) {
      expect(code).toContain(capsuleDependency.publishedRequirement);
    }
    const config = await loadBundle(code);
    expect(config.SIGIMA_INSTALL_SPEC).toBe(
      sigimaDependency.publishedRequirement,
    );
    expect(config.GUIDATA_INSTALL_SPEC).toBe(
      guidataDependency.publishedRequirement,
    );
    expect(config.DATALAB_CAPSULE_INSTALL_SPEC).toBe(
      capsuleDependency.publishedRequirement ?? "",
    );
  });

  it("uses no capsule requirement in release builds while unpublished", async () => {
    const { code, sourceMap } = await bundleDependencyConfig("release", null);
    expect(code).not.toContain(markers.capsule);
    expect(sourceMap).not.toContain(markers.capsule);
    const config = await loadBundle(code);
    expect(config.CAPSULE_PUBLISHED_REQUIREMENT).toBeNull();
    expect(config.DATALAB_CAPSULE_INSTALL_SPEC).toBe("");
  });
});
