/** Audit actual binary payloads, not a postMessage transfer list (clone counts too). */
export const benchmarkBuild =
  import.meta.env.VITE_WASM64_DEMO === "1" &&
  import.meta.env.VITE_WASM64_BENCHMARK === "1";

export function localBenchmarkBuild(): boolean {
  return (
    benchmarkBuild &&
    !import.meta.env.DEV &&
    globalThis.location?.hostname === "127.0.0.1"
  );
}

export function backingBytes(value: unknown): number {
  const objects = new Set<object>();
  const buffers = new Set<ArrayBufferLike>();
  function walk(v: unknown) {
    if (!v || typeof v !== "object" || objects.has(v)) return;
    objects.add(v);
    if (ArrayBuffer.isView(v)) buffers.add(v.buffer);
    else if (
      v instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        v instanceof SharedArrayBuffer)
    )
      buffers.add(v);
    else if (v instanceof Map) for (const entry of v) walk(entry);
    else if (v instanceof Set) for (const entry of v) walk(entry);
    else for (const child of Object.values(v)) walk(child);
  }
  walk(value);
  return [...buffers].reduce((n, b) => n + b.byteLength, 0);
}

export type TransferEvent = {
  boundary: "python" | "worker";
  method: string;
  pixels: number;
  backing: number;
  at: number;
};
let events: TransferEvent[] | undefined;

export function beginRecording() {
  if (events) throw new Error("Benchmark already started");
  events = [];
}

export function transferReport() {
  return events?.slice() ?? [];
}

export function recordResult(
  boundary: TransferEvent["boundary"],
  method: string,
  value: unknown,
  heap?: ArrayBufferLike,
) {
  if (!events) return;
  const images = (
    value as {
      images?: { width: number; height: number; data: unknown }[];
    } | null
  )?.images;
  let pixels = 0;
  for (const img of images ?? []) {
    const bytes = img.width * img.height * 4;
    if (!(
      bytes > 0 &&
      img.width <= 512 &&
      img.height <= 512 &&
      backingBytes(img.data) === bytes
    ))
      throw new Error("Unbounded or malformed image buffer");
    const views = Array.isArray(img.data) ? img.data : [img.data];
    if (
      views.some(
        (v) =>
          ArrayBuffer.isView(v) &&
          (v.buffer === heap || !(v.buffer instanceof ArrayBuffer)),
      )
    )
      throw new Error("Live/shared image buffer");
    pixels += bytes;
  }
  const backing = backingBytes(value);
  // Qualification permits pixels only in view snapshots; HDF5 is a separate run.
  if (backing !== pixels || pixels > 2 * 512 * 512 * 4)
    throw new Error(
      `Unexpected benchmark binary result: ${method} (${backing} bytes)`,
    );
  if (events.length >= 1024) throw new Error("Benchmark trace overflow");
  events.push({
    boundary,
    method,
    pixels,
    backing,
    at: performance.timeOrigin + performance.now(),
  });
}
