/**
 * Unit tests for the notebook ⇄ macro converters.
 *
 * The two converters are designed to round-trip cleanly so users can
 * iterate on the same workflow in either UI without losing structure.
 */

import { describe, expect, it } from "vitest";
import {
  notebookToMacro,
  notebookToMacroBody,
} from "../../src/notebook/notebookToMacro";
import {
  macroToNotebook,
  stripMacroHeader,
} from "../../src/macros/macroToNotebook";
import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type NotebookModel,
} from "../../src/notebook/types";

function buildMixedNotebook(): NotebookModel {
  const nb = emptyNotebook("Mixed");
  nb.cells = [
    emptyMarkdownCell("# Title\n\nA short paragraph."),
    emptyCodeCell("import numpy as np\nx = np.arange(10)"),
    emptyCodeCell('print("hello")'),
    emptyMarkdownCell("End of notebook."),
  ];
  return nb;
}

describe("notebookToMacro", () => {
  it("emits one block per cell with the right marker", () => {
    const nb = buildMixedNotebook();
    const body = notebookToMacroBody(nb);
    expect(body).toContain("# %% [markdown]");
    expect(body).toContain("# %%\nimport numpy as np");
    expect(body).toContain('# %%\nprint("hello")');
    // Markdown line prefixed with "# ".
    expect(body).toContain("# # Title");
  });

  it("uses the notebook name as macro title", () => {
    const nb = emptyNotebook("My macro");
    const { title, body } = notebookToMacro(nb);
    expect(title).toBe("My macro");
    // Empty cell yields just the code marker + nothing.
    expect(body.trimEnd()).toBe("# %%");
  });

  it("falls back to Untitled when name is empty", () => {
    const nb = emptyNotebook("   ");
    expect(notebookToMacro(nb).title).toBe("Untitled");
  });
});

describe("macroToNotebook", () => {
  it("splits a body on # %% markers", () => {
    const src = "# %%\nprint(1)\n\n# %%\nprint(2)\n";
    const nb = macroToNotebook("M", src);
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0].type).toBe("code");
    expect(nb.cells[0].source).toBe("print(1)");
    expect(nb.cells[1].source).toBe("print(2)");
  });

  it("recognises markdown blocks", () => {
    const src = "# %% [markdown]\n# Hello\n#\n# Para\n\n# %%\nx = 1\n";
    const nb = macroToNotebook("M", src);
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0].type).toBe("markdown");
    expect(nb.cells[0].source).toBe("Hello\n\nPara");
    expect(nb.cells[1].type).toBe("code");
  });

  it("keeps a single code cell when no marker is present", () => {
    const src = "x = 1\nprint(x)\n";
    const nb = macroToNotebook("M", src);
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].type).toBe("code");
    expect(nb.cells[0].source).toBe("x = 1\nprint(x)");
  });
});

describe("stripMacroHeader", () => {
  it("extracts the title and removes the header", () => {
    const src = [
      "# -*- coding: utf-8 -*-",
      "",
      '"""',
      'DataLab Macro: "My Title"',
      "-------------",
      "",
      "Description.",
      '"""',
      "",
      "x = 1",
    ].join("\n");
    const { title, body } = stripMacroHeader(src);
    expect(title).toBe("My Title");
    expect(body).toBe("x = 1");
  });

  it("returns null title when no header is present", () => {
    const src = "x = 1\n";
    const { title, body } = stripMacroHeader(src);
    expect(title).toBeNull();
    expect(body).toBe(src);
  });
});

describe("round-trip", () => {
  it("preserves cell structure through nb → macro → nb", () => {
    const original = buildMixedNotebook();
    const { body } = notebookToMacro(original);
    const restored = macroToNotebook(original.name, body);
    expect(restored.cells).toHaveLength(original.cells.length);
    for (let i = 0; i < original.cells.length; i += 1) {
      expect(restored.cells[i].type).toBe(original.cells[i].type);
      expect(restored.cells[i].source).toBe(original.cells[i].source);
    }
  });
});
