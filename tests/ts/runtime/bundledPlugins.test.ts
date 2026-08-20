import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BUNDLED_PLUGIN_WHEELS,
  fetchBundledPluginWheel,
} from "../../../src/runtime/bundledPlugins";

describe.each(BUNDLED_PLUGIN_WHEELS)("bundled $distribution wheel", (wheel) => {
  const wheelPath = resolve(
    process.cwd(),
    "src/runtime/builtin_wheels",
    wheel.filename,
  );

  it("matches its committed version, size, and SHA-256 manifest", async () => {
    const bytes = await readFile(wheelPath);

    expect(wheel.version).toBe("0.1.0");
    expect(bytes.byteLength).toBe(wheel.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(wheel.sha256);
  });

  it("loads only the bundled URL and verifies its SHA-256", async () => {
    const bytes = await readFile(wheelPath);
    const fetcher = vi.fn(async () => new Response(bytes, { status: 200 }));

    await expect(fetchBundledPluginWheel(wheel, fetcher)).resolves.toEqual(
      new Uint8Array(bytes),
    );
    expect(fetcher).toHaveBeenCalledWith(wheel.url);

    const corrupted = new Uint8Array(bytes);
    corrupted[0] ^= 0xff;
    fetcher.mockImplementationOnce(
      async () => new Response(corrupted, { status: 200 }),
    );

    await expect(fetchBundledPluginWheel(wheel, fetcher)).rejects.toThrow(
      "SHA-256 mismatch",
    );
  });
});
