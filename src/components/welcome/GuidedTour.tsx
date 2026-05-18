/**
 * GuidedTour — lightweight, zero-dependency step-by-step overlay
 * inspired by the desktop DataLab tour (``datalab/gui/tour.py``).
 *
 * Each step optionally targets one or more DOM elements via CSS
 * selectors (typically ``data-tour="…"`` attributes on stable hosts).
 * The overlay paints four absolutely-positioned panels around the
 * **union** bounding rect to create a "cover" / cut-out effect, then
 * draws an extra highlight ring around every individual target and
 * renders a tooltip card next to the union rect.
 *
 * Steps without any ``targetSelector`` render as a centered modal card
 * — useful for the welcome and closing steps of the tour.
 *
 * Each step may also declare ``onEnter`` / ``onLeave`` callbacks that
 * are fired when the step becomes active / is left.  This is used by
 * the default tour to programmatically open menus, switch between
 * Signal and Image panels and seed/cleanup demo objects.
 *
 * The tour re-measures targets every animation frame while open so
 * window resizes, scrolls and dynamic layout shifts stay tracked.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface TourStep {
  /** Optional CSS selector(s) for the element(s) to highlight.  When
   *  omitted the step renders as a centered modal.  When an array,
   *  the tooltip is positioned around the union bounding box and
   *  every individual element gets its own highlight ring. */
  targetSelector?: string | string[];
  title: string;
  body: ReactNode;
  /** Preferred placement of the tooltip card relative to the target. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Called when the step becomes active.  May mutate the DOM (open
   *  menus, switch panels, seed demo data); the overlay will then
   *  wait ``waitForTargetMs`` before giving up on locating targets. */
  onEnter?: () => void | Promise<void>;
  /** Called when leaving the step (Next / Previous / Restart / Close). */
  onLeave?: () => void;
  /** How long to keep trying to locate the target after ``onEnter``
   *  before falling back to a centered modal.  Defaults to 400 ms. */
  waitForTargetMs?: number;
}

export interface GuidedTourProps {
  open: boolean;
  steps: TourStep[];
  onClose: () => void;
  /** Optional final callback (distinct from ``onClose`` if needed). */
  onFinish?: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TOOLTIP_WIDTH = 340;
const TOOLTIP_OFFSET = 14;
const HIGHLIGHT_PADDING = 6;
const DEFAULT_WAIT_MS = 400;

function asSelectorArray(s: TourStep["targetSelector"]): string[] {
  if (!s) return [];
  return Array.isArray(s) ? s : [s];
}

function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.top < top) top = r.top;
    if (r.left < left) left = r.left;
    if (r.left + r.width > right) right = r.left + r.width;
    if (r.top + r.height > bottom) bottom = r.top + r.height;
  }
  return { top, left, width: right - left, height: bottom - top };
}

function rectsEqual(a: Rect[], b: Rect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (
      ra.top !== rb.top ||
      ra.left !== rb.left ||
      ra.width !== rb.width ||
      ra.height !== rb.height
    ) {
      return false;
    }
  }
  return true;
}

export function GuidedTour({
  open,
  steps,
  onClose,
  onFinish,
}: GuidedTourProps) {
  const [index, setIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<Rect[]>([]);
  const rafRef = useRef<number | null>(null);
  const enterDeadlineRef = useRef<number>(0);
  // We track the *index* of the previously active step (rather than
  // the step object reference) because ``steps`` is typically a new
  // array on every parent render — useMemo over an evolving context
  // produces a fresh object identity even when the logical step is
  // unchanged.  Keying off identity caused onLeave/onEnter to fire
  // on every parent render, which on menu-popup steps repeatedly
  // closed + reopened the dropdown (user-visible flicker) and on
  // heavier menus (Analysis) saturated the event loop.
  const lastIndexRef = useRef<number>(-1);
  const lastStepRef = useRef<TourStep | null>(null);

  const step = steps[index];

  // Reset position when the tour is (re-)opened.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Fire onEnter / onLeave around step transitions.  The effect is
  // keyed on (open, index, steps.length) only — never on the step
  // *object* identity — so unrelated re-renders never re-trigger the
  // lifecycle callbacks.
  useEffect(() => {
    if (!open) {
      const prev = lastStepRef.current;
      if (prev) {
        try {
          prev.onLeave?.();
        } catch (err) {
          console.error("GuidedTour onLeave threw:", err);
        }
        lastStepRef.current = null;
        lastIndexRef.current = -1;
      }
      return;
    }
    const current = steps[index];
    if (!current) return;
    if (lastIndexRef.current === index) return; // pure re-render, ignore
    const prev = lastStepRef.current;
    if (prev) {
      try {
        prev.onLeave?.();
      } catch (err) {
        console.error("GuidedTour onLeave threw:", err);
      }
    }
    lastStepRef.current = current;
    lastIndexRef.current = index;
    enterDeadlineRef.current =
      Date.now() + (current.waitForTargetMs ?? DEFAULT_WAIT_MS);
    try {
      const ret = current.onEnter?.();
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        (ret as Promise<unknown>).catch((err: unknown) =>
          console.error("GuidedTour onEnter rejected:", err),
        );
      }
    } catch (err) {
      console.error("GuidedTour onEnter threw:", err);
    }
    // ``steps`` is intentionally read inside the effect but excluded
    // from deps — see the lastIndexRef rationale above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // Cleanup on unmount: fire onLeave of the active step.
  useEffect(() => {
    return () => {
      const prev = lastStepRef.current;
      if (prev) {
        try {
          prev.onLeave?.();
        } catch (err) {
          console.error("GuidedTour onLeave threw:", err);
        }
        lastStepRef.current = null;
        lastIndexRef.current = -1;
      }
    };
  }, []);

  // Track every target's bounding rectangle while the tour is open.
  // Polling on rAF keeps us in sync with arbitrary layout shifts
  // (Splitter drags, panel mounts, async ``onEnter`` callbacks…)
  // without listening on every possible source of change.  Keyed on
  // ``index`` (not on the step object reference) so unrelated
  // re-renders do not tear down and re-establish the loop.
  useEffect(() => {
    const current = steps[index];
    if (!open || !current) {
      setTargetRects([]);
      return;
    }
    const selectors = asSelectorArray(current.targetSelector);
    if (selectors.length === 0) {
      setTargetRects([]);
      return;
    }
    const measure = () => {
      const found: Rect[] = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            found.push({
              top: r.top,
              left: r.left,
              width: r.width,
              height: r.height,
            });
          }
        }
      }
      // Hold off on committing partial measurements while we are
      // still inside the grace window after ``onEnter`` — otherwise
      // multi-target steps (e.g. menu label + ``.menu-dropdown``)
      // would briefly highlight only the first target before the
      // dropdown mounts, which the user perceives as the menu being
      // "shown twice" (first closed, then opened).  Once the grace
      // window elapses, we commit whatever we have.
      const allFound = found.length === selectors.length;
      const stillWaiting = Date.now() < enterDeadlineRef.current;
      if (!allFound && stillWaiting) {
        rafRef.current = requestAnimationFrame(measure);
        return;
      }
      setTargetRects((prev) => (rectsEqual(prev, found) ? prev : found));
      rafRef.current = requestAnimationFrame(measure);
    };
    rafRef.current = requestAnimationFrame(measure);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // Keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, steps.length]);

  const handleNext = useCallback(() => {
    if (index >= steps.length - 1) {
      onFinish?.();
      onClose();
    } else {
      setIndex(index + 1);
    }
  }, [index, steps.length, onClose, onFinish]);

  const handlePrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleRestart = useCallback(() => {
    // Force onLeave of the conclusion step before bouncing back to 0
    // so any side effect bound to the final step is cleared.
    const prev = lastStepRef.current;
    if (prev) {
      try {
        prev.onLeave?.();
      } catch (err) {
        console.error("GuidedTour onLeave threw:", err);
      }
      lastStepRef.current = null;
    }
    setIndex(0);
  }, []);

  if (!open || !step) return null;

  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const union = unionRect(targetRects);
  const padded = union && {
    top: union.top - HIGHLIGHT_PADDING,
    left: union.left - HIGHLIGHT_PADDING,
    width: union.width + 2 * HIGHLIGHT_PADDING,
    height: union.height + 2 * HIGHLIGHT_PADDING,
  };

  const tooltipStyle = padded
    ? computeTooltipStyle(padded, step.placement)
    : ({
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      } as React.CSSProperties);

  return (
    <div
      className="guided-tour"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
    >
      {padded ? (
        <>
          {/* Four cover panels surrounding the cut-out — mirrors the
              desktop "Cover" widget approach in tour.py. */}
          <div
            className="guided-tour-cover"
            style={{ top: 0, left: 0, right: 0, height: Math.max(0, padded.top) }}
          />
          <div
            className="guided-tour-cover"
            style={{
              top: padded.top + padded.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className="guided-tour-cover"
            style={{
              top: padded.top,
              left: 0,
              width: Math.max(0, padded.left),
              height: padded.height,
            }}
          />
          <div
            className="guided-tour-cover"
            style={{
              top: padded.top,
              left: padded.left + padded.width,
              right: 0,
              height: padded.height,
            }}
          />
          {/* Highlight ring around every individual target. */}
          {targetRects.map((r, i) => (
            <div
              key={i}
              className="guided-tour-highlight"
              style={{
                top: r.top - HIGHLIGHT_PADDING,
                left: r.left - HIGHLIGHT_PADDING,
                width: r.width + 2 * HIGHLIGHT_PADDING,
                height: r.height + 2 * HIGHLIGHT_PADDING,
              }}
            />
          ))}
        </>
      ) : (
        <div className="guided-tour-cover guided-tour-cover-full" />
      )}

      <div
        className="guided-tour-card"
        style={tooltipStyle}
        // Stop ``mousedown`` from reaching ``document`` — otherwise
        // MenuBar's outside-click listener (registered via
        // ``document.addEventListener``) fires *before* the button's
        // click handler runs.  On menu-popup steps that unmounts the
        // dropdown, triggers a state cascade that on Analysis-class
        // steps saturates the React reconciler ("Maximum update depth
        // exceeded") and freezes the page.
        //
        // Important: React's ``e.stopPropagation()`` only stops the
        // *synthetic* event from bubbling further through React's
        // tree — the underlying *native* event still bubbles up the
        // real DOM to ``document``.  We must call
        // ``stopImmediatePropagation`` on the native event to actually
        // prevent MenuBar's document-level listener from firing.
        onMouseDownCapture={(e) => {
          e.nativeEvent.stopImmediatePropagation();
          e.stopPropagation();
        }}
      >
        <div className="guided-tour-card-header">
          <span className="guided-tour-card-counter">
            {index + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="guided-tour-card-close"
            onClick={onClose}
            aria-label="Close tour"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <h3 className="guided-tour-card-title">{step.title}</h3>
        <div className="guided-tour-card-body">{step.body}</div>
        <div className="guided-tour-card-actions">
          {isLast ? (
            <button
              type="button"
              className="guided-tour-card-skip"
              onClick={handleRestart}
            >
              Restart
            </button>
          ) : (
            <button
              type="button"
              className="guided-tour-card-skip"
              onClick={onClose}
            >
              Skip tour
            </button>
          )}
          <div className="guided-tour-card-nav">
            <button type="button" onClick={handlePrev} disabled={isFirst}>
              Previous
            </button>
            <button type="button" className="primary" onClick={handleNext}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function computeTooltipStyle(
  rect: Rect,
  placement: TourStep["placement"] = "bottom",
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const w = TOOLTIP_WIDTH;
  // Conservative height estimate — the card auto-sizes vertically
  // but we need a value to decide whether a placement would overflow.
  const hEstimate = 220;

  type Placement = NonNullable<TourStep["placement"]>;

  // Candidate (top, left) per placement, in absolute viewport
  // coordinates — no CSS transform required, which keeps clamping
  // simple and avoids the bug where ``translate(-100%, …)`` shifted
  // the card off-screen on left-placed steps (the previous clamp
  // checked the raw ``left`` instead of the post-transform position).
  const candidates: Record<Placement, { top: number; left: number }> = {
    top: {
      top: rect.top - TOOLTIP_OFFSET - hEstimate,
      left: rect.left + rect.width / 2 - w / 2,
    },
    bottom: {
      top: rect.top + rect.height + TOOLTIP_OFFSET,
      left: rect.left + rect.width / 2 - w / 2,
    },
    left: {
      top: rect.top + rect.height / 2 - hEstimate / 2,
      left: rect.left - TOOLTIP_OFFSET - w,
    },
    right: {
      top: rect.top + rect.height / 2 - hEstimate / 2,
      left: rect.left + rect.width + TOOLTIP_OFFSET,
    },
  };

  const fits = (c: { top: number; left: number }) =>
    c.left >= margin &&
    c.left + w <= vw - margin &&
    c.top >= margin &&
    c.top + hEstimate <= vh - margin;

  const opposite: Record<Placement, Placement> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };

  // Auto-flip when the preferred placement does not fit.
  let chosen = candidates[placement];
  if (!fits(chosen) && fits(candidates[opposite[placement]])) {
    chosen = candidates[opposite[placement]];
  }

  // Final clamp — even if no placement fits perfectly, keep the card
  // fully inside the viewport.
  const left = Math.min(Math.max(chosen.left, margin), vw - w - margin);
  const top = Math.min(
    Math.max(chosen.top, margin),
    Math.max(margin, vh - hEstimate - margin),
  );
  return { top, left, width: w };
}
