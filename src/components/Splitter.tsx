/**
 * Splitter — vertical drag handle to resize a sibling panel.
 *
 * Lives between two flex children of the workspace.  ``side`` tells
 * the splitter which neighbour it controls (the left or the right
 * one).  Dragging updates ``value`` through ``onChange`` and the host
 * is responsible for clamping/persisting it.
 */

import { useCallback, useEffect, useRef } from "react";

interface Props {
  /** Which neighbour the splitter resizes — "left"/"right" for vertical
   *  splitters (drag horizontally); "top"/"bottom" for horizontal
   *  splitters (drag vertically).  ``"top"`` widens by dragging down,
   *  ``"bottom"`` widens by dragging up. */
  side: "left" | "right" | "top" | "bottom";
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  ariaLabel?: string;
}

export function Splitter({
  side,
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: Props) {
  const dragging = useRef<{
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);
  const horizontal = side === "top" || side === "bottom";

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragging.current = {
        startX: event.clientX,
        startY: event.clientY,
        startValue: value,
      };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      document.body.style.cursor = horizontal ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [value, horizontal],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = dragging.current;
      if (!state) return;
      let delta: number;
      if (horizontal) {
        delta = event.clientY - state.startY;
        const signed = side === "bottom" ? -delta : delta;
        const next = Math.min(max, Math.max(min, state.startValue + signed));
        onChange(next);
      } else {
        delta = event.clientX - state.startX;
        const signed = side === "right" ? -delta : delta;
        const next = Math.min(max, Math.max(min, state.startValue + signed));
        onChange(next);
      }
    },
    [side, min, max, onChange, horizontal],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = null;
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(
          event.pointerId,
        );
      } catch {
        /* pointer was already released */
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  // Cleanup body cursor on unmount in case the pointer-up event was
  // missed (e.g. component unmounted mid-drag).
  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  return (
    <div
      className={`splitter ${horizontal ? "splitter-horizontal" : "splitter-vertical"}`}
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={ariaLabel ?? "Resize panel"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => {
        // Reset to mid-range — handy escape hatch when the user has
        // dragged the panel outside the visible area.
        onChange(Math.round((min + max) / 2));
      }}
    >
      <div className="splitter-grip" aria-hidden="true" />
    </div>
  );
}
