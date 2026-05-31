/// <reference types="vitest" />
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * Dedicated config for the opt-in shim version audit.
 *
 * The default ``npm test`` run only matches ``*.test.{ts,tsx}`` files, so
 * the audit (``shim-audit.spec.ts``, which hits the network) is naturally
 * excluded. This config re-targets Vitest at that single spec for
 * ``npm run audit:shims`` and the ``🔍 Audit shims (versions)`` VS Code task.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/ts/shims/shim-audit.spec.ts"],
    },
  }),
);
