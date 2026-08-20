/**
 * Vitest setup file — runs once before the TS test suite.
 *
 * Extends ``expect`` with @testing-library/jest-dom matchers
 * (``toBeInTheDocument``, ``toHaveClass``, …) and provides minimal
 * polyfills for Web APIs that jsdom doesn't ship by default.
 */
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ``window.matchMedia`` — needed by the theme
// helper. Provide an inert stub so calls don't blow up in tests.
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (
    query: string,
  ) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Node 20 Web Crypto rejects BufferSource values created in jsdom's realm.
// Adapt digest inputs to a native Buffer while keeping browser semantics.
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require("node:crypto");
  const nativeDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  Object.defineProperty(webcrypto.subtle, "digest", {
    value: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const bytes = ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : Buffer.from(data);
      return nativeDigest(algorithm, bytes);
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  Object.defineProperty(window, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
