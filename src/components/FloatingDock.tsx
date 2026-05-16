/**
 * FloatingDockStack — right-anchored overlay container that stacks its
 * children horizontally from right to left.
 *
 * Hosts every floating panel (AI Assistant, detached Notebook, detached
 * Macro, …).  Using a single flex ``row-reverse`` container guarantees
 * that overlays never overlap and that their visual order is purely
 * determined by their JSX order — no manual ``right`` offset math.
 */

import type { ReactNode } from "react";

export interface FloatingDockStackProps {
    children?: ReactNode;
}

/**
 * Right-anchored absolute container; flex row-reverse so the first
 * child sits rightmost and additional children stack leftward.  An
 * 8px gap separates them.  ``pointer-events: none`` on the stack
 * itself + ``pointer-events: auto`` on each :class:`FloatingDockSlot`
 * means the gaps between overlays don't block clicks on the plot
 * beneath them.
 */
export function FloatingDockStack({
    children,
}: FloatingDockStackProps): JSX.Element {
    return <div className="floating-dock-stack">{children}</div>;
}

export interface FloatingDockSlotProps {
    /** Logical width hint applied as the slot's CSS width. */
    width?: number;
    /** Extra class appended to the slot wrapper (visual variants). */
    className?: string;
    children?: ReactNode;
}

/**
 * Standard chrome (border, shadow, rounded corners) for a single
 * overlay panel hosted in a :class:`FloatingDockStack`.  Apply this
 * around any panel that wants to look like the existing AI Assistant
 * overlay.
 */
export function FloatingDockSlot({
    width,
    className,
    children,
}: FloatingDockSlotProps): JSX.Element {
    const cls = ["floating-dock-host", className].filter(Boolean).join(" ");
    return (
        <div className={cls} style={width ? { width } : undefined}>
            {children}
        </div>
    );
}
