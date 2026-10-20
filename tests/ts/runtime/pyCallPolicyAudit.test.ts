/**
 * Audit of the disk-guard page-in policy against the call sites of
 * ``runtime.ts``.
 *
 * In on-disk storage mode, the disk guard pages in the objects named by the
 * kwargs of a call before running it (``pyCallPolicy.ts``). A call naming an
 * object through an unknown key would run on its 1-element placeholder (a
 * blank view, a dialog initialized from zeros, a wrong recipe assessment), so
 * every identifier-like key passed to ``callPy`` must be classified.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  NON_OBJECT_ID_KEYS,
  PAGE_IN_ID_KEYS,
  PAGE_IN_ID_LIST_KEYS,
  PAGE_IN_ID_MAPPING_KEYS,
  pageInPlan,
  referencedOids,
} from "../../../src/runtime/pyCallPolicy";

const RUNTIME_TS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "runtime",
  "runtime.ts",
);

/** Keys that may name an object: ``*oid(s)``, ``*_id(s)``, ``id(s)``, and
 *  the mappings of ids. */
const ID_LIKE = /(^|_)(oid|oids|id|ids)$|^bindings$/;

/** Return the index of the bracket closing the one at *start*. */
function closingIndex(text: string, start: number): number {
  const open = text[start];
  const close = { "(": ")", "{": "}", "[": "]" }[open] as string;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced "${open}" in runtime.ts`);
}

/** Return the property keys of the object literal *body* (without braces),
 *  including those of the literals spread into it. */
function literalKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  for (const raw of parts) {
    const part = raw.trim();
    if (part.startsWith("...")) {
      // ``...(cond ? { a: x } : {})``: keep the keys of the spread literals.
      for (const match of part.matchAll(/([A-Za-z_][A-Za-z_0-9]*)\s*:/g)) {
        keys.push(match[1]);
      }
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z_0-9]*)\s*(:|$)/.exec(part);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/** Return ``{ name, keys }`` for every ``callPy`` / ``callPyLatest`` call
 *  of ``runtime.ts`` passing an object literal as kwargs. */
function callSites(): Array<{ name: string; keys: string[] }> {
  const source = readFileSync(RUNTIME_TS, "utf8");
  const sites: Array<{ name: string; keys: string[] }> = [];
  for (const match of source.matchAll(
    /this\.callPy(Latest)?\s*(?:<[\s\S]*?>)?\s*\(/g,
  )) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = source.slice(open + 1, closingIndex(source, open));
    const literals = Array.from(args.matchAll(/"([^"]*)"/g), (m) => m[1]);
    const name = match[1] ? literals[1] : literals[0];
    const brace = args.indexOf("{");
    if (brace < 0) continue;
    const keys = literalKeys(args.slice(brace + 1, closingIndex(args, brace)));
    sites.push({ name, keys });
  }
  return sites;
}

describe("disk-guard page-in policy", () => {
  it("finds the call sites of runtime.ts", () => {
    const names = new Set(callSites().map((site) => site.name));
    // Guard against a silent breakage of the parser itself.
    expect(names).toContain("get_signal_view_snapshot");
    expect(names).toContain("run_plugin_recipe");
    expect(names).toContain("reapply_last_processing");
  });

  it("classifies every identifier-like kwarg passed to Python", () => {
    const known = new Set([
      ...PAGE_IN_ID_KEYS,
      ...PAGE_IN_ID_LIST_KEYS,
      ...PAGE_IN_ID_MAPPING_KEYS,
      ...NON_OBJECT_ID_KEYS,
    ]);
    const unknown = callSites().flatMap(({ name, keys }) =>
      keys
        .filter((key) => ID_LIKE.test(key) && !known.has(key))
        .map((key) => `${name}(${key})`),
    );
    expect(
      unknown,
      "Add these keys to a PAGE_IN_* list or to NON_OBJECT_ID_KEYS " +
        "(src/runtime/pyCallPolicy.ts)",
    ).toEqual([]);
  });

  it("does not classify a key twice", () => {
    const keys = [
      ...PAGE_IN_ID_KEYS,
      ...PAGE_IN_ID_LIST_KEYS,
      ...PAGE_IN_ID_MAPPING_KEYS,
      ...NON_OBJECT_ID_KEYS,
    ];
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("collects distinct ids from single, list and mapping keys", () => {
    expect(
      referencedOids({
        current_oid: "A",
        selected_oids: ["A", "B"],
        source_oid: "C",
        bindings: { signals: ["D", "B"], reference: ["E"] },
        candidate_ids: "F",
        feature_id: "not-an-object",
        group_ids: ["G"],
      }),
    ).toEqual(["A", "C", "B", "F", "D", "E"]);
  });

  it("plans the page-in of each kind of call", () => {
    expect(pageInPlan("delete_group", { gid: "g" })).toEqual({ kind: "none" });
    expect(
      pageInPlan("describe_object_provenance", { object_id: "A" }),
    ).toEqual({ kind: "none" });
    expect(pageInPlan("save_workspace_to_bytes", {})).toEqual({ kind: "all" });
    expect(pageInPlan("get_last_processing", { oid: "R" })).toEqual({
      kind: "resolve",
      helper: "last_processing_input_ids",
      kwargs: { oid: "R" },
    });
    expect(pageInPlan("replay_activity", { activity_id: "act" })).toEqual({
      kind: "resolve",
      helper: "activity_object_ids",
      kwargs: { activity_id: "act" },
    });
    expect(pageInPlan("get_feature_schema", { source_oid: "S" })).toEqual({
      kind: "ids",
      oids: ["S"],
    });
  });
});
