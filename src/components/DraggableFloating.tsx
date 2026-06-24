/**
 * DraggableFloating — minimal draggable + resizable overlay window.
 *
 * Wraps a panel in an absolutely-positioned container that can be
 * dragged by any descendant matching ``dragHandleSelector`` (default:
 * ``.panel-header``).  Position and size are persisted in
 * ``localStorage`` under ``storageKey`` so the window reopens where
 * the user left it.  Resizing is native CSS (``resize: both``); we
 * only observe the resulting size to persist it.
 *
 * Intentionally tiny — no portals, no z-index manager, no snapping.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface DraggableFloatingProps {
  storageKey: string;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  dragHandleSelector?: string;
  className?: string;
  children?: ReactNode;
}

interface PersistedRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function loadRect(key: string): PersistedRect | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRect>;
    if (
      typeof parsed.top === "number" &&
      typeof parsed.left === "number" &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      return parsed as PersistedRect;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveRect(key: string, rect: PersistedRect): void {
  try {
    localStorage.setItem(key, JSON.stringify(rect));
  } catch {
    /* ignore */
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function DraggableFloating({
  storageKey,
  defaultWidth = 400,
  defaultHeight,
  minWidth = 280,
  minHeight = 240,
  dragHandleSelector = ".panel-header",
  className,
  children,
}: DraggableFloatingProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<PersistedRect>(() => {
    const stored = loadRect(storageKey);
    if (stored) return stored;
    // Default placement: top-right corner with 8px margin (matches the
    // historical right-anchored dock, which spanned the full workspace
    // height with an 8px top/bottom margin).  ``defaultHeight`` opts into
    // a compact initial height instead of spanning the full viewport.
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const height =
      defaultHeight !== undefined
        ? clamp(defaultHeight, minHeight, vh - 16)
        : Math.max(minHeight, vh - 16);
    return {
      top: 8,
      left: Math.max(8, vw - defaultWidth - 8),
      width: defaultWidth,
      height,
    };
  });

  // Persist on every change (debounced via microtask-free simple write).
  useEffect(() => {
    saveRect(storageKey, rect);
  }, [storageKey, rect]);

  // Clamp into viewport on mount and on window resize so a smaller
  // viewport doesn't strand the window off-screen.
  useLayoutEffect(() => {
    const onResize = () => {
      setRect((prev) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = clamp(prev.width, minWidth, vw - 16);
        const height = clamp(prev.height, minHeight, vh - 16);
        const left = clamp(prev.left, 0, Math.max(0, vw - width));
        const top = clamp(prev.top, 0, Math.max(0, vh - height));
        if (
          left === prev.left &&
          top === prev.top &&
          width === prev.width &&
          height === prev.height
        ) {
          return prev;
        }
        return { left, top, width, height };
      });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minHeight, minWidth]);

  // Observe native CSS resize on the host so we persist the new size.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Read the border-box size from the live element (offset*) — using
    // ``contentRect`` would exclude the 1px border and, with the inline
    // ``style.width`` reapplied as border-box via the CSS rule below,
    // feed back into an ever-shrinking loop on every observation.
    const ro = new ResizeObserver(() => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      setRect((prev) => {
        if (
          Math.abs(width - prev.width) < 2 &&
          Math.abs(height - prev.height) < 2
        ) {
          return prev;
        }
        return { ...prev, width, height };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const host = hostRef.current;
      if (!host) return;
      const target = event.target as Element | null;
      if (!target || !target.closest(dragHandleSelector)) return;
      // Ignore drags initiated on buttons / inputs inside the header.
      if (
        target.closest("button, input, textarea, select, a, [data-no-drag]")
      ) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      const pointerId = event.pointerId;
      (event.currentTarget as HTMLDivElement).setPointerCapture?.(pointerId);

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setRect((prev) => ({
          ...prev,
          left: clamp(startLeft + dx, 0, Math.max(0, vw - prev.width)),
          top: clamp(startTop + dy, 0, Math.max(0, vh - prev.height)),
        }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [dragHandleSelector, rect.left, rect.top],
  );

  const onResizeBottomLeft = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startWidth = rect.width;
      const startHeight = rect.height;
      const pointerId = event.pointerId;
      (event.currentTarget as HTMLDivElement).setPointerCapture?.(pointerId);

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = clamp(startWidth - dx, minWidth, startLeft + startWidth);
        const left = clamp(startLeft + (startWidth - width), 0, vw - minWidth);
        const height = clamp(startHeight + dy, minHeight, vh - 8);
        setRect((prev) => ({ ...prev, left, width, height }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [minHeight, minWidth, rect.height, rect.left, rect.width],
  );

  const cls = ["floating-window", className].filter(Boolean).join(" ");

  return (
    <div
      ref={hostRef}
      className={cls}
      onPointerDown={onPointerDown}
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
    >
      {children}
      <div
        className="floating-window-resize-sw"
        onPointerDown={onResizeBottomLeft}
        role="presentation"
        aria-hidden
      />
    </div>
  );
}
