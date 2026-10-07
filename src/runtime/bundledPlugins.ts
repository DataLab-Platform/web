import cameraWheelUrl from "./builtin_wheels/datalab_camera_characterization-0.2.0-py3-none-any.whl?url";
import pulseWheelUrl from "./builtin_wheels/datalab_pulse_characterization-0.2.0-py3-none-any.whl?url";

export interface BundledPluginWheel {
  distribution: string;
  version: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  url: string;
}

/** Integrity-only build catalog for plugin wheels shipped with DataLab-Web. */
export const BUNDLED_PLUGIN_WHEELS: readonly BundledPluginWheel[] =
  Object.freeze([
    Object.freeze({
      distribution: "datalab-camera-characterization",
      version: "0.2.0",
      filename: "datalab_camera_characterization-0.2.0-py3-none-any.whl",
      sha256:
        "b110475273e1daae9525912777d927cdba101f92646d70451ec0194481c5676c",
      sizeBytes: 328_574,
      url: cameraWheelUrl,
    }),
    Object.freeze({
      distribution: "datalab-pulse-characterization",
      version: "0.2.0",
      filename: "datalab_pulse_characterization-0.2.0-py3-none-any.whl",
      sha256:
        "84bf8efb051e47db9afe225b71b85bd95175718c2e2c3c048e5e275c3b9e812e",
      sizeBytes: 75_123,
      url: pulseWheelUrl,
    }),
  ]);

export function getBundledPluginWheel(
  distribution: string,
): BundledPluginWheel {
  const wheel = BUNDLED_PLUGIN_WHEELS.find(
    (candidate) => candidate.distribution === distribution,
  );
  if (!wheel) throw new Error(`Unknown bundled plugin wheel: ${distribution}`);
  return wheel;
}

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

/** Fetch and verify one Vite-bundled wheel without consulting package indexes. */
export async function fetchBundledPluginWheel(
  wheel: BundledPluginWheel,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(wheel.url);
  if (!response.ok) {
    throw new Error(
      `Failed to load bundled plugin wheel ${wheel.distribution} ` +
        `(${response.status} ${response.statusText})`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== wheel.sizeBytes) {
    throw new Error(
      `Bundled plugin wheel ${wheel.distribution} size mismatch: ` +
        `expected ${wheel.sizeBytes}, got ${bytes.byteLength}`,
    );
  }
  const digest = await sha256(bytes);
  if (digest !== wheel.sha256) {
    throw new Error(
      `Bundled plugin wheel ${wheel.distribution} SHA-256 mismatch: ` +
        `expected ${wheel.sha256}, got ${digest}`,
    );
  }
  return bytes;
}

/** Fetch all bundled wheels concurrently while preserving catalog order. */
export async function fetchBundledPluginWheels(
  fetcher: typeof fetch = fetch,
): Promise<Array<{ wheel: BundledPluginWheel; bytes: Uint8Array }>> {
  return Promise.all(
    BUNDLED_PLUGIN_WHEELS.map(async (wheel) => ({
      wheel,
      bytes: await fetchBundledPluginWheel(wheel, fetcher),
    })),
  );
}
