/**
 * Tests for :class:`CoordsEditor` — image coords preview + import +
 * switch button.
 */

import { describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  CoordsEditor,
  parseCsvNumbers,
} from "../../../src/components/CoordsEditor";
import type { DataLabRuntime } from "../../../src/runtime/runtime";

function makeRuntime(overrides: Partial<DataLabRuntime> = {}): DataLabRuntime {
  const base: Partial<DataLabRuntime> = {
    getImageCoords: vi.fn().mockResolvedValue({
      is_uniform: true,
      shape: [3, 4] as [number, number],
      x: [0, 1, 2, 3],
      y: [0, 1, 2],
    }),
    setImageCoords: vi.fn().mockResolvedValue(undefined),
    switchImageCoordsType: vi.fn().mockResolvedValue({ is_uniform: false }),
  };
  return { ...base, ...overrides } as unknown as DataLabRuntime;
}

describe("parseCsvNumbers", () => {
  it("parses comma-separated numbers and skips headers", () => {
    expect(parseCsvNumbers("axis\n0.1\n0.2\n0.3")).toEqual([0.1, 0.2, 0.3]);
  });
  it("accepts whitespace / semicolons", () => {
    expect(parseCsvNumbers("1; 2; 3\n4 5 6")).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("skips '#' comments and non-numeric tokens", () => {
    expect(parseCsvNumbers("# coords\n1,foo,2\n")).toEqual([1, 2]);
  });
  it("returns empty list for blank input", () => {
    expect(parseCsvNumbers("")).toEqual([]);
  });
});

describe("CoordsEditor", () => {
  it("renders coords summary and head/tail preview", async () => {
    const runtime = makeRuntime();
    render(
      <CoordsEditor
        runtime={runtime}
        oid="img1"
        refreshNonce={0}
        onChanged={() => {}}
      />,
    );
    expect(
      await screen.findByText(/Coordinates \(4 × 3 — uniform\)/),
    ).toBeInTheDocument();
    expect(runtime.getImageCoords).toHaveBeenCalledWith("img1");
    // Both axes labelled
    expect(screen.getByText(/X \(width = 4\)/)).toBeInTheDocument();
    expect(screen.getByText(/Y \(height = 3\)/)).toBeInTheDocument();
  });

  it("switch button calls switchImageCoordsType with the opposite mode", async () => {
    const runtime = makeRuntime();
    const onChanged = vi.fn();
    render(
      <CoordsEditor
        runtime={runtime}
        oid="img1"
        refreshNonce={0}
        onChanged={onChanged}
      />,
    );
    const btn = await screen.findByRole("button", {
      name: /Switch to non-uniform/,
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(runtime.switchImageCoordsType).toHaveBeenCalledWith(
      "img1",
      "non-uniform",
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("importing a CSV with the right length calls setImageCoords", async () => {
    const runtime = makeRuntime();
    const onChanged = vi.fn();
    render(
      <CoordsEditor
        runtime={runtime}
        oid="img1"
        refreshNonce={0}
        onChanged={onChanged}
      />,
    );
    await screen.findByText(/Coordinates/);
    const input = screen.getByTestId("coords-import-x") as HTMLInputElement;
    const file = new File(["10\n20\n30\n40\n"], "x.csv", {
      type: "text/csv",
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(runtime.setImageCoords).toHaveBeenCalledWith(
        "img1",
        [10, 20, 30, 40],
        [0, 1, 2],
      );
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("rejects a CSV with the wrong length and shows an error", async () => {
    const runtime = makeRuntime();
    render(
      <CoordsEditor
        runtime={runtime}
        oid="img1"
        refreshNonce={0}
        onChanged={() => {}}
      />,
    );
    await screen.findByText(/Coordinates/);
    const input = screen.getByTestId("coords-import-x") as HTMLInputElement;
    const file = new File(["10\n20\n"], "x.csv", { type: "text/csv" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(
      await screen.findByText(/X length mismatch: got 2, expected 4/),
    ).toBeInTheDocument();
    expect(runtime.setImageCoords).not.toHaveBeenCalled();
  });
});
