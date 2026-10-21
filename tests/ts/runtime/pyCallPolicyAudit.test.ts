/**
 * Audit of the Python call policy against the call sites of ``runtime.ts``.
 *
 * In on-disk storage mode, the disk guard pages in the objects named by the
 * kwargs of a call before running it (``pyCallPolicy.ts``). A call naming an
 * object through an unknown key would run on its 1-element placeholder (a
 * blank view, a dialog initialized from zeros, a wrong recipe assessment), so
 * every identifier-like key passed to ``callPy`` must be classified.
 *
 * The workspace dirty flag is raised after the calls listed in
 * ``MUTATING_PY_FUNCTIONS``: a call named like a write must be classified
 * too, otherwise its changes can be lost without any unsaved-changes warning.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DIRTY_SET_BY_CALLER,
  MUTATES_HEAVY,
  MUTATING_PY_FUNCTIONS,
  NON_DURABLE_WRITE_CALLS,
  NON_OBJECT_ID_KEYS,
  PAGE_IN_ID_KEYS,
  PAGE_IN_ID_LIST_KEYS,
  PAGE_IN_ID_MAPPING_KEYS,
  REPLACES_MODEL,
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
 *  of ``runtime.ts``; *keys* is empty unless kwargs are an object literal. */
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
    const keys =
      brace < 0
        ? []
        : literalKeys(args.slice(brace + 1, closingIndex(args, brace)));
    sites.push({ name, keys });
  }
  return sites;
}

/** Python functions whose name announces a change of state. */
const WRITE_LIKE =
  /^(set|update|add|delete|remove|create|import|commit|apply|move|rename|clear|reset|replace|paste|duplicate|erase|distribute|plot|trigger|run|launch|acquire|reorder|extract|open)_/;

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

describe("workspace dirty policy", () => {
  const called = new Set(callSites().map((site) => site.name));

  it("classifies every write-like call to Python", () => {
    const classified = new Set([
      ...MUTATING_PY_FUNCTIONS,
      ...REPLACES_MODEL,
      ...DIRTY_SET_BY_CALLER,
      ...NON_DURABLE_WRITE_CALLS,
    ]);
    const unclassified = [...called]
      .filter((name) => WRITE_LIKE.test(name) && !classified.has(name))
      .sort();
    expect(
      unclassified,
      "Add these calls to MUTATING_PY_FUNCTIONS, or to NON_DURABLE_WRITE_CALLS " +
        "if they change no state saved with the workspace " +
        "(src/runtime/pyCallPolicy.ts)",
    ).toEqual([]);
  });

  it("marks the workspace dirty after an in-place data change", () => {
    const missing = [...MUTATES_HEAVY].filter(
      (name) => !MUTATING_PY_FUNCTIONS.has(name),
    );
    expect(missing).toEqual([]);
  });

  it("does not classify a call twice", () => {
    const exclusive = [
      MUTATING_PY_FUNCTIONS,
      DIRTY_SET_BY_CALLER,
      NON_DURABLE_WRITE_CALLS,
    ];
    const names = exclusive.flatMap((set) => [...set]);
    expect(names.length).toBe(new Set(names).size);
  });

  it("only exempts calls made by runtime.ts", () => {
    const stale = [...DIRTY_SET_BY_CALLER, ...NON_DURABLE_WRITE_CALLS].filter(
      (name) => !called.has(name),
    );
    expect(stale).toEqual([]);
  });
});
