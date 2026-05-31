/**
 * Tests for :class:`ArrayEditorDialog` — the graphical grid editor that
 * replaces the comma-separated FloatArrayItem fallback.
 *
 * Covers the pure conversion helpers (normalise / flatten / paste /
 * format) and the interactive behaviour (cell edit, add / remove rows
 * and columns, 1-D vs 2-D round-trip, transpose, read-only mode).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  ArrayEditorDialog,
  normalizeToMatrix,
  matrixToValue,
  parseClipboardMatrix,
  formatCell,
} from "../../../src/components/ArrayEditorDialog";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeToMatrix", () => {
  it("treats a flat array as a 1-D column vector", () => {
    const { matrix, is1D } = normalizeToMatrix([1, 2, 3]);
    expect(is1D).toBe(true);
    expect(matrix).toEqual([[1], [2], [3]]);
  });

  it("keeps a nested array as a 2-D matrix", () => {
    const { matrix, is1D } = normalizeToMatrix([
      [1, 2],
      [3, 4],
    ]);
    expect(is1D).toBe(false);
    expect(matrix).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("coerces non-finite / non-numeric entries to 0", () => {
    const { matrix } = normalizeToMatrix([1, "x", null]);
    expect(matrix).toEqual([[1], [0], [0]]);
  });

  it("returns an empty 1-D matrix for non-array input", () => {
    expect(normalizeToMatrix(undefined)).toEqual({ matrix: [], is1D: true });
    expect(normalizeToMatrix([])).toEqual({ matrix: [], is1D: true });
  });
});

describe("matrixToValue", () => {
  it("flattens a column vector back to a flat array when 1-D", () => {
    expect(matrixToValue([[1], [2], [3]], true)).toEqual([1, 2, 3]);
  });

  it("preserves the 2-D shape when not 1-D", () => {
    expect(
      matrixToValue(
        [
          [1, 2],
          [3, 4],
        ],
        false,
      ),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("parseClipboardMatrix", () => {
  it("parses tab-separated rows (Excel / pandas default)", () => {
    expect(parseClipboardMatrix("1\t2\n3\t4")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("parses comma-separated rows", () => {
    expect(parseClipboardMatrix("1,2\n3,4")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("ignores blank lines and trims CRLF", () => {
    expect(parseClipboardMatrix("1,2\r\n\r\n3,4\r\n")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("formatCell", () => {
  it("applies a printf-style fixed format", () => {
    expect(formatCell(1.23456, "%.3f")).toBe("1.235");
  });

  it("applies %e and %d", () => {
    expect(formatCell(1234, "%.2e")).toBe("1.23e+3");
    expect(formatCell(1.7, "%d")).toBe("2");
  });

  it("falls back to the default form without a format", () => {
    expect(formatCell(1.5)).toBe("1.5");
  });
});

// ---------------------------------------------------------------------------
// Component behaviour
// ---------------------------------------------------------------------------

function inputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(".array-editor-grid td input"),
  );
}

describe("ArrayEditorDialog", () => {
  it("round-trips an edited 2-D matrix", () => {
    const onSubmit = vi.fn();
    render(
      <ArrayEditorDialog
        value={[
          [1, 2],
          [3, 4],
        ]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const cells = inputs();
    expect(cells).toHaveLength(4);
    fireEvent.change(cells[0], { target: { value: "9" } });
    fireEvent.click(screen.getByText("OK"));
    expect(onSubmit).toHaveBeenCalledWith([
      [9, 2],
      [3, 4],
    ]);
  });

  it("flattens a 1-D column vector on submit", () => {
    const onSubmit = vi.fn();
    render(
      <ArrayEditorDialog
        value={[1, 2, 3]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("OK"));
    expect(onSubmit).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("adds and removes rows when variableSize is enabled", () => {
    const onSubmit = vi.fn();
    render(
      <ArrayEditorDialog
        value={[1, 2]}
        variableSize
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("+ Row"));
    expect(inputs()).toHaveLength(3);
    fireEvent.click(screen.getByText("− Row"));
    expect(inputs()).toHaveLength(2);
  });

  it("adds columns only for 2-D arrays with variableSize", () => {
    render(
      <ArrayEditorDialog
        value={[[1, 2]]}
        variableSize
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("+ Col"));
    expect(inputs()).toHaveLength(3);
  });

  it("does not expose column controls for a 1-D array", () => {
    render(
      <ArrayEditorDialog
        value={[1, 2, 3]}
        variableSize
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("+ Col")).toBeNull();
  });

  it("undoes the display transpose before producing the value", () => {
    const onSubmit = vi.fn();
    render(
      <ArrayEditorDialog
        value={[
          [1, 2, 3],
          [4, 5, 6],
        ]}
        transpose
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    // Displayed transposed (3 rows × 2 cols) but value keeps original shape.
    expect(inputs()).toHaveLength(6);
    fireEvent.click(screen.getByText("OK"));
    expect(onSubmit).toHaveBeenCalledWith([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("renders read-only cells without inputs and no OK button", () => {
    render(
      <ArrayEditorDialog
        value={[[1.23456]]}
        format="%.2f"
        readOnly
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(inputs()).toHaveLength(0);
    expect(screen.getByText("1.23")).toBeTruthy();
    expect(screen.queryByText("OK")).toBeNull();
  });
});
