import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Splitter } from "../../../src/components/Splitter";

describe("Splitter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coalesces drag updates per frame and commits the final value", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const onChange = vi.fn();
    const onCommit = vi.fn();

    render(
      <Splitter
        side="left"
        value={200}
        min={100}
        max={300}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    const separator = screen.getByRole("separator");
    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 120 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 150 });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    act(() => frames[0](0));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(250);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 180 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 180 });

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(280);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(280);
  });
});
