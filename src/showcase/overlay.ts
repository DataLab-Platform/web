/**
 * Visual overlays of the showcase: caption banner, title/end cards, boot
 * card, spotlight, fake pointer with click ripple, status badge and the
 * shield that keeps the real pointer from disturbing a playing demo.
 *
 * Plain DOM in a fixed, click-through layer attached to ``document.body``
 * (outside the React root, so application re-renders never touch it; it is
 * re-attached if something removes it).
 */

import logoUrl from "../assets/DataLab.svg";
import "./showcase.css";

export interface CardContent {
  kicker?: string;
  title: string;
  subtitle?: string;
  note?: string;
  /** Spinner and status line (boot card). */
  spinner?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BadgeKind = "info" | "pause" | "idle";

const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">' +
  '<path d="M4 2 L4 25 L10 19.5 L14.2 28 L18 26.2 L13.9 17.8 L22 17.8 Z" ' +
  'fill="#ffffff" stroke="#111827" stroke-width="1.8" stroke-linejoin="round"/></svg>';

export class ShowcaseOverlay {
  private root: HTMLDivElement | null = null;
  private badgeTimer = 0;

  /** Attach the layer and hide the real pointer (autoplay mode). */
  mount(): void {
    this.ensureRoot();
    this.setMode("autoplay");
  }

  /** Remove every overlay and restore the real pointer. */
  unmount(): void {
    window.clearTimeout(this.badgeTimer);
    this.root?.remove();
    this.root = null;
    document.documentElement.removeAttribute("data-showcase");
  }

  /** ``autoplay`` hides the real pointer; ``idle`` gives it back and hides
   *  the fake one (the operator has stopped the demos). */
  setMode(mode: "autoplay" | "idle"): void {
    document.documentElement.setAttribute("data-showcase", mode);
  }

  /** Whether ``node`` belongs to the overlay layer. */
  contains(node: Node | null): boolean {
    return !!node && !!this.root && this.root.contains(node);
  }

  caption(
    head: string,
    text: string,
    opts: { position?: "top" | "bottom"; notice?: boolean } = {},
  ): void {
    const el = this.part("showcase-caption");
    el.textContent = "";
    if (head) this.child(el, "showcase-caption-head", head);
    this.child(el, "showcase-caption-text", text);
    el.className = "showcase-caption";
    if (opts.position === "top") el.classList.add("showcase-caption--top");
    if (opts.notice) el.classList.add("showcase-caption--notice");
    void el.offsetWidth; // restart the pop-in animation
    el.classList.add("showcase-caption--pop");
  }

  clearCaption(): void {
    this.removePart("showcase-caption");
  }

  /** Full-screen card (``id`` distinguishes the boot card from the
   *  title/end cards); fades in. */
  card(content: CardContent, id = "card"): HTMLElement {
    this.cardElement(id)?.remove();
    const el = document.createElement("div");
    el.className = "showcase-card";
    el.dataset.card = id;
    const logo = document.createElement("img");
    logo.className = "showcase-card-logo";
    logo.src = logoUrl;
    logo.alt = "";
    el.appendChild(logo);
    if (content.kicker) this.child(el, "showcase-card-kicker", content.kicker);
    this.child(el, "showcase-card-title", content.title);
    if (content.subtitle) {
      this.child(el, "showcase-card-subtitle", content.subtitle);
    }
    if (content.spinner) {
      this.child(el, "showcase-spinner", "");
      this.child(el, "showcase-card-status", "");
    }
    if (content.note) this.child(el, "showcase-card-note", content.note);
    this.ensureRoot().appendChild(el);
    void el.offsetWidth; // commit the transparent state before fading in
    el.classList.add("showcase-card--visible");
    return el;
  }

  /** Update the status line of a card with a spinner. */
  cardStatus(text: string, id = "boot"): void {
    const status = this.cardElement(id)?.querySelector(".showcase-card-status");
    if (status && status.textContent !== text) status.textContent = text;
  }

  hasCard(id = "card"): boolean {
    return this.cardElement(id) !== null;
  }

  /** Fade a card out, then remove it. */
  async clearCard(fadeMs = 450, id = "card"): Promise<void> {
    const el = this.cardElement(id);
    if (!el) return;
    delete el.dataset.card;
    el.classList.remove("showcase-card--visible");
    await new Promise((resolve) => window.setTimeout(resolve, fadeMs));
    el.remove();
  }

  /** Dim everything but ``rect`` (viewport coordinates). */
  spotlight(rect: Rect): void {
    const el = this.part("showcase-spotlight");
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }

  clearSpotlight(): void {
    this.removePart("showcase-spotlight");
  }

  /** Move the fake pointer (its tip) to ``(x, y)``. */
  cursor(x: number, y: number): void {
    const el = this.part("showcase-cursor");
    if (!el.firstChild) el.innerHTML = CURSOR_SVG;
    el.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
  }

  ripple(x: number, y: number): void {
    const el = document.createElement("div");
    el.className = "showcase-ripple";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.ensureRoot().appendChild(el);
    window.setTimeout(() => el.remove(), 700);
  }

  /** Show a status badge (top right); ``null`` hides it. With a duration,
   *  the badge disappears by itself. */
  badge(text: string | null, kind: BadgeKind = "info", durationMs = 0): void {
    window.clearTimeout(this.badgeTimer);
    if (!text) {
      this.removePart("showcase-badge");
      return;
    }
    const el = this.part("showcase-badge");
    el.textContent = text;
    el.className = `showcase-badge showcase-badge--${kind}`;
    if (durationMs > 0) {
      this.badgeTimer = window.setTimeout(
        () => this.removePart("showcase-badge"),
        durationMs,
      );
    }
  }

  /** Persistent label (top centre) flagging the current demo, e.g. a
   *  simulated session; ``null`` removes it. */
  sticker(text: string | null): void {
    if (!text) {
      this.removePart("showcase-sticker");
      return;
    }
    this.part("showcase-sticker").textContent = text;
  }

  /** Catch the real pointer while a demo plays (``onPointer`` is told when
   *  someone clicks or touches the screen). */
  shield(on: boolean, onPointer?: () => void): void {
    if (!on) {
      this.removePart("showcase-shield");
      return;
    }
    const el = this.part("showcase-shield");
    el.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPointer?.();
    };
    el.onwheel = (event) => event.preventDefault();
  }

  /** Remove caption, spotlight, label and title/end card (not the boot
   *  card). */
  clearAll(): void {
    this.clearCaption();
    this.clearSpotlight();
    this.sticker(null);
    this.cardElement("card")?.remove();
  }

  private ensureRoot(): HTMLDivElement {
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.className = "showcase-overlay";
      this.root.setAttribute("aria-hidden", "true");
    }
    if (!this.root.isConnected) document.body.appendChild(this.root);
    return this.root;
  }

  private part(className: string): HTMLElement {
    const root = this.ensureRoot();
    let el = root.querySelector<HTMLElement>(`:scope > .${className}`);
    if (!el) {
      el = document.createElement("div");
      el.className = className;
      root.appendChild(el);
    }
    return el;
  }

  private removePart(className: string): void {
    this.root?.querySelector(`:scope > .${className}`)?.remove();
  }

  private cardElement(id: string): HTMLElement | null {
    return (
      this.root?.querySelector<HTMLElement>(
        `:scope > .showcase-card[data-card="${id}"]`,
      ) ?? null
    );
  }

  private child(parent: HTMLElement, className: string, text: string): void {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    parent.appendChild(el);
  }
}
