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
    addListener: () => { },
    removeListener: () => { },
    addEventListener: () => { },
    removeEventListener: () => { },
    dispatchEvent: () => false,
  });
}

// jsdom 24+ ships ``window.crypto.subtle``; older versions don't. We only
// need the ``digest`` method for the trust-store hashing tests.
if (
  typeof window !== "undefined" &&
  (!window.crypto || !window.crypto.subtle)
) {
  // Lazy-import the Node implementation. ``webcrypto`` is available since
  // Node 18.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require("node:crypto");
  Object.defineProperty(window, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
