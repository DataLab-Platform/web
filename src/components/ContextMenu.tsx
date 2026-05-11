import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActionState, MenuNode } from "../actions/types";
import { MenuDropdown } from "./MenuDropdown";

interface ContextMenuProps {
  nodes: MenuNode[];
  state: ActionState;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Floating context menu rendered at viewport coordinates.
 *
 * Closes on outside click, ``Escape``, scroll or window resize.
 * Position is clamped so the menu never overflows the viewport.
 */
export function ContextMenu({
  nodes,
  state,
  position,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(position);

  // Re-clamp every time the source position changes.
  useLayoutEffect(() => {
    setPos(position);
  }, [position]);

  // After the menu has been laid out, clamp it inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  useEffect(() => {
    const handleDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleScroll);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{
        position: "fixed",
        top: pos.y,
        left: pos.x,
        zIndex: 1000,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuDropdown nodes={nodes} state={state} onClose={onClose} />
    </div>
  );
}
