import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadRuntimeConfig,
  loadConfiguredPyodide,
  parseRuntimeConfig,
  pythonWheelInstallCode,
  resetRuntimeConfigForTests,
  resolveRuntimeConfig,
  type RuntimeConfig,
} from "../../../src/runtime/runtimeConfig";

const SHA256 = "a".repeat(64);

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    schemaVersion: 1,
    distribution: "local",
    pyodideVersion: "0.26.4",
    pyodideIndexUrl: "./pyodide/",
    pyodidePackages: {
      main: ["numpy", "scipy", "micropip"],
      macro: ["numpy", "micropip"],
      notebook: ["numpy", "micropip"],
    },
    pythonWheels: [
      {
        name: "sigima",
        version: "1.1.6",
        url: "./wheels/sigima-1.1.6-py3-none-any.whl",
        sha256: SHA256,
      },
    ],
    allowPublicNetwork: false,
    ...overrides,
  };
}

afterEach(() => resetRuntimeConfigForTests());

describe("runtime configuration", () => {
  it("resolves local assets from the configuration document under a sub-path", () => {
    const resolved = resolveRuntimeConfig(
      config(),
      "https://apps.example/tools/datalab/runtime-config.json",
    );

    expect(resolved.deploymentRootUrl).toBe(
      "https://apps.example/tools/datalab/",
    );
    expect(resolved.pyodideModuleUrl).toBe(
      "https://apps.example/tools/datalab/pyodide/pyodide.mjs",
    );
    expect(resolved.pythonWheels[0].url).toBe(
      "https://apps.example/tools/datalab/wheels/sigima-1.1.6-py3-none-any.whl",
    );
  });

  it("rejects public URLs in a local distribution", () => {
    expect(() =>
      resolveRuntimeConfig(
        config({ pyodideIndexUrl: "https://cdn.example/pyodide/" }),
        "https://apps.example/datalab/runtime-config.json",
      ),
    ).toThrow(/deployment root/);
  });

  it("rejects paths that escape the deployment root", () => {
    const value = config({
      pythonWheels: [
        {
          name: "sigima",
          version: "1.1.6",
          url: "../sigima.whl",
          sha256: SHA256,
        },
      ],
    });
    expect(() =>
      resolveRuntimeConfig(
        value,
        "https://apps.example/datalab/runtime-config.json",
      ),
    ).toThrow(/deployment root/);
  });

  it("rejects malformed hashes and floating versions", () => {
    const malformed = config({
      pythonWheels: [
        {
          name: "sigima",
          version: ">=1.1.6",
          url: "./wheels/sigima.whl",
          sha256: "not-a-hash",
        },
      ],
    });
    expect(() => parseRuntimeConfig(malformed)).toThrow(/version|sha256/);
  });

  it("loads the configuration once from the document deployment root", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(config()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const first = loadRuntimeConfig(
      "https://apps.example/tools/datalab/index.html",
      fetcher,
    );
    const second = loadRuntimeConfig(
      "https://apps.example/ignored/index.html",
      fetcher,
    );

    await expect(first).resolves.toMatchObject({ distribution: "local" });
    await expect(second).resolves.toMatchObject({ distribution: "local" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://apps.example/tools/datalab/runtime-config.json",
    );
  });

  it("loads the configured Pyodide module and reports its source on failure", async () => {
    const resolved = resolveRuntimeConfig(
      config(),
      "https://apps.example/datalab/runtime-config.json",
    );
    const loadPyodide = vi.fn(async () => ({ ready: true }));
    const importer = vi.fn(async () => ({ loadPyodide }));

    await expect(loadConfiguredPyodide(resolved, importer)).resolves.toEqual({
      ready: true,
    });
    expect(importer).toHaveBeenCalledWith(
      "https://apps.example/datalab/pyodide/pyodide.mjs",
    );
    expect(loadPyodide).toHaveBeenCalledWith({
      indexURL: "https://apps.example/datalab/pyodide/",
    });

    await expect(
      loadConfiguredPyodide(resolved, async () => {
        throw new Error("network blocked");
      }),
    ).rejects.toThrow(/pyodide\.mjs.*network blocked.*DEPLOY\.md/);
  });

  it("disables Micropip dependency resolution for local distributions", () => {
    const local = resolveRuntimeConfig(
      config(),
      "https://apps.example/datalab/runtime-config.json",
    );
    expect(pythonWheelInstallCode(local)).toContain("deps=False");

    const online = resolveRuntimeConfig(
      config({ distribution: "cdn", allowPublicNetwork: true }),
      "https://apps.example/datalab/runtime-config.json",
    );
    expect(pythonWheelInstallCode(online)).toContain("deps=True");
  });
});
