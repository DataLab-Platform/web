import wheelUrl from "./builtin_wheels/datalab_camera_characterization-0.1.0-py3-none-any.whl?url";

/** Build-time contract for the Camera wheel shipped inside DataLab-Web. */
export const BUNDLED_CAMERA_WHEEL = Object.freeze({
  distribution: "datalab-camera-characterization",
  version: "0.1.0",
  filename: "datalab_camera_characterization-0.1.0-py3-none-any.whl",
  sha256: "d0688e36171709631327f48a1bfa1d2c798403f6d5b7634ed89985bc738990c1",
  sizeBytes: 122_544,
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
export async function fetchBundledCameraWheel(
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(BUNDLED_CAMERA_WHEEL.url);
  if (!response.ok) {
    throw new Error(
      `Failed to load bundled Camera wheel (${response.status} ${response.statusText})`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== BUNDLED_CAMERA_WHEEL.sizeBytes) {
    throw new Error(
      `Bundled Camera wheel size mismatch: expected ${BUNDLED_CAMERA_WHEEL.sizeBytes}, got ${bytes.byteLength}`,
    );
  }
  const digest = await sha256(bytes);
  if (digest !== BUNDLED_CAMERA_WHEEL.sha256) {
    throw new Error(
      `Bundled Camera wheel SHA-256 mismatch: expected ${BUNDLED_CAMERA_WHEEL.sha256}, got ${digest}`,
    );
  }
  return bytes;
}
