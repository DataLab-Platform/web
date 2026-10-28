/**
 * Audit of the public surface of ``DataLabRuntime`` against the worker
 * boundary.
 *
 * In worker mode (the default), the UI talks to the runtime through the
 * ``WorkerRuntimeProxy`` façade, which forwards *method calls* over
 * ``postMessage``. Two things silently break across that boundary:
 *
 *   * a public field or getter: reading it from the UI returns a
 *     forwarding function instead of the value (the AI Assistant's
 *     ``get_macro_console_output`` once returned nothing for that reason);
 *   * a DOM event dispatched by the runtime: there is no ``window`` in the
 *     worker, so the UI never receives it ("Save to Macros" once created
 *     macros the Macros panel never showed).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const RUNTIME_TS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "runtime",
  "runtime.ts",
);

const SOURCE = readFileSync(RUNTIME_TS, "utf-8");

function runtimeClass(): ts.ClassDeclaration {
  const file = ts.createSourceFile(
    RUNTIME_TS,
    SOURCE,
    ts.ScriptTarget.Latest,
    true,
  );
  let found: ts.ClassDeclaration | undefined;
  file.forEachChild((node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === "DataLabRuntime") {
      found = node;
    }
  });
  if (!found) throw new Error("DataLabRuntime class not found");
  return found;
}

function isPublicInstanceMember(member: ts.ClassElement): boolean {
  const modifiers = ts.canHaveModifiers(member)
    ? (ts.getModifiers(member) ?? [])
    : [];
  const hidden = modifiers.some(
    (m) =>
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.StaticKeyword,
  );
  return !hidden && !(member.name && ts.isPrivateIdentifier(member.name));
}

describe("DataLabRuntime worker boundary", () => {
  it("exposes only methods (no public field or accessor)", () => {
    const offenders = runtimeClass()
      .members.filter(isPublicInstanceMember)
      .filter(
        (m) =>
          ts.isPropertyDeclaration(m) ||
          ts.isGetAccessorDeclaration(m) ||
          ts.isSetAccessorDeclaration(m),
      )
      .map((m) => m.name?.getText() ?? "?");
    expect(offenders).toEqual([]);
  });

  it("does not notify the UI through DOM events", () => {
    expect(SOURCE).not.toMatch(
      /\b(window|document)\s*\.\s*(dispatchEvent|addEventListener)\s*\(/,
    );
  });
});
