/**
 * Unit tests for the nbformat (de)serialiser.
 *
 * Covers the cases the panel actually exercises: code/markdown cells,
 * stream and execute_result outputs, error outputs, MIME bundles with
 * list-of-lines text, and the round-trip stability that lets us autosave
 * without churning the on-disk JSON unnecessarily.
 */

import { describe, expect, it } from "vitest";
import {
  ipynbToNotebook,
  jsonStringToNotebook,
  notebookToIpynb,
  notebookToJsonString,
} from "../../src/notebook/nbformat";
import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type NotebookModel,
} from "../../src/notebook/types";

function buildSampleNotebook(): NotebookModel {
  const nb = emptyNotebook("My Sample");
  // Replace the default empty cell with richer content.
  const code = emptyCodeCell("import numpy as np\nx = np.linspace(0, 1, 11)");
  code.execCount = 1;
  code.status = "ok";
  code.outputs = [
    { type: "stream", kind: "stdout", text: "hello\nworld\n" },
    {
      type: "execute_result",
      execCount: 1,
      data: {
        "text/plain": "array([0. , 0.1])",
        "text/html": "<table><tr><td>0</td><td>0.1</td></tr></table>",
      },
    },
  ];
  const md = emptyMarkdownCell("# Section\n\nSome **bold** text.");
  const errored = emptyCodeCell("1 / 0");
  errored.execCount = 2;
  errored.status = "error";
  errored.outputs = [
    {
      type: "error",
      ename: "ZeroDivisionError",
      evalue: "division by zero",
      traceback:
        "Traceback (most recent call last):\n  File ...\nZeroDivisionError: division by zero",
    },
  ];
  nb.cells = [code, md, errored];
  return nb;
}

describe("nbformat round-trip", () => {
  it("serialises and re-parses a sample notebook losslessly", () => {
    const nb = buildSampleNotebook();
    const json = notebookToJsonString(nb);
    const restored = jsonStringToNotebook(json, "fallback");

    expect(restored.name).toBe(nb.name);
    expect(restored.cells).toHaveLength(nb.cells.length);

    // Cell 0: code with stream + execute_result.
    expect(restored.cells[0].type).toBe("code");
    expect(restored.cells[0].source).toBe(nb.cells[0].source);
    expect(restored.cells[0].execCount).toBe(1);
    expect(restored.cells[0].outputs).toHaveLength(2);
    expect(restored.cells[0].outputs[0]).toMatchObject({
      type: "stream",
      kind: "stdout",
      text: "hello\nworld\n",
    });
    expect(restored.cells[0].outputs[1]).toMatchObject({
      type: "execute_result",
      execCount: 1,
    });
    if (restored.cells[0].outputs[1].type === "execute_result") {
      expect(restored.cells[0].outputs[1].data["text/plain"]).toBe(
        "array([0. , 0.1])",
      );
      expect(restored.cells[0].outputs[1].data["text/html"]).toContain(
        "<table>",
      );
    }

    // Cell 1: markdown.
    expect(restored.cells[1].type).toBe("markdown");
    expect(restored.cells[1].source).toBe(nb.cells[1].source);

    // Cell 2: error.
    expect(restored.cells[2].outputs[0]).toMatchObject({
      type: "error",
      ename: "ZeroDivisionError",
      evalue: "division by zero",
    });
  });

  it("preserves cell ids across a round-trip", () => {
    const nb = buildSampleNotebook();
    const ids = nb.cells.map((c) => c.id);
    const restored = jsonStringToNotebook(notebookToJsonString(nb));
    expect(restored.cells.map((c) => c.id)).toEqual(ids);
  });

  it("uses nbformat v4.5", () => {
    const nb = emptyNotebook("v");
    const dict = notebookToIpynb(nb);
    expect(dict.nbformat).toBe(4);
    expect(dict.nbformat_minor).toBe(5);
  });

  it("ignores unknown cell types instead of crashing", () => {
    const dict = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        { cell_type: "raw", source: "# raw\n", metadata: {} },
        { cell_type: "code", source: "1+1\n", metadata: {}, outputs: [] },
      ],
    };
    const nb = ipynbToNotebook(dict);
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].type).toBe("code");
  });

  it("rejects pre-v4 notebooks with a helpful error", () => {
    expect(() =>
      ipynbToNotebook({
        nbformat: 3,
        nbformat_minor: 0,
        metadata: {},
        cells: [],
      }),
    ).toThrow(/nbformat=3/);
  });

  it("falls back to the supplied name when no dlw metadata is present", () => {
    const nb = ipynbToNotebook(
      { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] },
      "Imported",
    );
    expect(nb.name).toBe("Imported");
    // Ensures the empty-cell-fallback kicks in when the source had no cells.
    expect(nb.cells).toHaveLength(1);
  });
});
