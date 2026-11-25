// Paths on GitHub Pages share an origin. The demo has one profile for both
// engines; the stable build must keep its existing names byte for byte.
export const DEMO_STORAGE_PREFIX = "dlw-wasm64-demo.";

export function storageName(name: string): string {
  return import.meta.env.VITE_WASM64_DEMO === "1"
    ? DEMO_STORAGE_PREFIX + name
    : name;
}
