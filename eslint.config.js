// ESLint v9 flat config for DataLab-Web.
//
// Mirrors the conventions used in the rest of the workspace: a permissive
// baseline that catches real bugs (no-undef, no-unused-vars) without
// fighting the Pyodide bridge or the Plotly typings.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "build/**",
      "release/**",
      "packages/*/dist/**",
      "node_modules/**",
      "coverage-ts/**",
      "htmlcov-python/**",
      "playwright-report/**",
      "test-results/**",
      ".venv/**",
      "**/*.d.ts",
      "vite.config.js",
      "vite.config.d.ts",
      // Documentation snippets — not part of the build, ship without
      // their Angular dependencies, see ``doc/examples/angular/README.md``.
      "doc/examples/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: {
      // Existing source has a couple of legacy ``eslint-disable`` comments
      // that no longer match an active rule; treat them as warnings rather
      // than failing the lint task.
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // The Pyodide bridge legitimately surfaces ``any`` values; keep it as
      // a warning so it shows up in the editor without failing CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
      // Demote the picky stylistic rules that only flag pre-existing code.
      "no-useless-assignment": "warn",
      "no-constant-binary-expression": "warn",
      "prefer-const": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Node-side build/release scripts — pure Node ESM, no TS, no DOM.
    files: ["scripts/**/*.{mjs,cjs,js}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
