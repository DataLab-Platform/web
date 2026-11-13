import cameraWheelUrl from "./builtin_wheels/datalab_camera_characterization-0.2.1-py3-none-any.whl?url";
import pulseWheelUrl from "./builtin_wheels/datalab_pulse_characterization-0.2.1-py3-none-any.whl?url";
import radiographyWheelUrl from "./builtin_wheels/datalab_radiography-0.1.0-py3-none-any.whl?url";

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
      version: "0.2.1",
      filename: "datalab_camera_characterization-0.2.1-py3-none-any.whl",
      sha256:
        "b2942edccb890c4421b3a49ee31e70926254238bb774c07505dec431daeb6c0d",
      sizeBytes: 329_042,
      url: cameraWheelUrl,
    }),
    Object.freeze({
      distribution: "datalab-pulse-characterization",
      version: "0.2.1",
      filename: "datalab_pulse_characterization-0.2.1-py3-none-any.whl",
      sha256:
        "51ec3ecf5f390ed4eaf785f949dd6da7bbac353f317d5c804f12ec8354d8db74",
      sizeBytes: 79_826,
      url: pulseWheelUrl,
    }),
    Object.freeze({
      distribution: "datalab-radiography",
      version: "0.1.0",
      filename: "datalab_radiography-0.1.0-py3-none-any.whl",
      sha256:
        "5915c734a1449f4ac7cfdbbac603fe48f31262d69beb21df65463a13e8cdb0d8",
      sizeBytes: 1_277_453,
      url: radiographyWheelUrl,
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
