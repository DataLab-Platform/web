import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BUNDLED_PULSE_WHEEL,
  fetchBundledPulseWheel,
} from "../../../src/runtime/bundledPulse";

const WHEEL_PATH = resolve(
  process.cwd(),
  "src/runtime/builtin_wheels",
  BUNDLED_PULSE_WHEEL.filename,
);

describe("bundled Pulse wheel", () => {
  it("matches its committed version, size, and SHA-256 manifest", async () => {
    const bytes = await readFile(WHEEL_PATH);

    expect(BUNDLED_PULSE_WHEEL.distribution).toBe(
      "datalab-pulse-characterization",
    );
    expect(BUNDLED_PULSE_WHEEL.version).toBe("0.1.0");
    expect(bytes.byteLength).toBe(BUNDLED_PULSE_WHEEL.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      BUNDLED_PULSE_WHEEL.sha256,
    );
  });

  it("loads only the bundled URL and verifies its SHA-256", async () => {
    const wheel = await readFile(WHEEL_PATH);
    const fetcher = vi.fn(async () => new Response(wheel, { status: 200 }));

    await expect(fetchBundledPulseWheel(fetcher)).resolves.toEqual(
      new Uint8Array(wheel),
    );
    expect(fetcher).toHaveBeenCalledWith(BUNDLED_PULSE_WHEEL.url);

    const corrupted = new Uint8Array(wheel);
    corrupted[0] ^= 0xff;
    fetcher.mockImplementationOnce(
      async () => new Response(corrupted, { status: 200 }),
    );

    await expect(fetchBundledPulseWheel(fetcher)).rejects.toThrow(
      "wheel SHA-256 mismatch",
    );
  });
});
