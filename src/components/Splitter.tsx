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
  /** Which neighbour the splitter resizes — "left" widens by dragging
   *  right, "right" widens by dragging left. */
  side: "left" | "right";
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
  const dragging = useRef<{ startX: number; startValue: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragging.current = { startX: event.clientX, startValue: value };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [value],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = dragging.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      const signed = side === "right" ? -delta : delta;
      const next = Math.min(max, Math.max(min, state.startValue + signed));
      onChange(next);
    },
    [side, min, max, onChange],
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
      className="splitter splitter-vertical"
      role="separator"
      aria-orientation="vertical"
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
