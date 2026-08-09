import wheelUrl from "./builtin_wheels/datalab_pulse_characterization-0.1.0-py3-none-any.whl?url";

/** Build-time contract for the Pulse wheel shipped inside DataLab-Web. */
export const BUNDLED_PULSE_WHEEL = Object.freeze({
  distribution: "datalab-pulse-characterization",
  version: "0.1.0",
  filename: "datalab_pulse_characterization-0.1.0-py3-none-any.whl",
  sha256: "36f65f79f76285316772715f91608ce5a28f83ce6f7c1d49485cbcd79ca5d3b7",
  sizeBytes: 28_954,
  url: wheelUrl,
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Fetch the Vite-bundled wheel; public package indexes are never consulted. */
export async function fetchBundledPulseWheel(
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(BUNDLED_PULSE_WHEEL.url);
  if (!response.ok) {
    throw new Error(
      `Failed to load bundled Pulse wheel (${response.status} ${response.statusText})`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== BUNDLED_PULSE_WHEEL.sizeBytes) {
    throw new Error(
      `Bundled Pulse wheel size mismatch: expected ${BUNDLED_PULSE_WHEEL.sizeBytes}, got ${bytes.byteLength}`,
    );
  }
  const digest = await sha256(bytes);
  if (digest !== BUNDLED_PULSE_WHEEL.sha256) {
    throw new Error(
      `Bundled Pulse wheel SHA-256 mismatch: expected ${BUNDLED_PULSE_WHEEL.sha256}, got ${digest}`,
    );
  }
  return bytes;
}
