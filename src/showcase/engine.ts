/**
 * In-page engine of the showcase mode.
 *
 * A showcase scenario drives the real DataLab Web UI from inside the page,
 * the way a visitor would: a fake pointer glides to each target, which then
 * receives realistic pointer/mouse/keyboard events (so React handlers, the
 * hover-driven menus and CodeMirror editors react as with a real user),
 * with readable pauses, captions, title cards and spotlighting.
 *
 * Authoring conventions:
 *
 *   * interact through the context (``ctx.click``, ``ctx.clickMenuPath``,
 *     ``ctx.type``…) so that the audience sees what happens; use
 *     ``ctx.runAction(id)`` when a visible menu walk is not needed;
 *   * every user-visible text goes through the app's ``t()`` (English is
 *     the key; add the French translation to ``src/locales/fr.json``);
 *   * name menus, menu items and tabs so that they work in any UI language:
 *     top menus by their ``data-menu-top`` key, menu actions by their
 *     action id (e.g. ``"create.signal.gauss"``, the most robust) or their
 *     canonical menu path segment, submenus by their English label;
 *   * verify progress with ``ctx.checkpoint(cond, message)`` (throws);
 *   * throw :class:`ScenarioSkipped` when a prerequisite is missing.
 *
 * In check mode (``speed === 0``, ``?check=1``) there are no pauses, no
 * overlays and no pointer animation: the same code then runs as a fast
 * functional test (see ``tests/e2e/showcase/``).
 */

import { EditorView } from "@codemirror/view";
import { flushSync } from "react-dom";
import "./i18n";
import { t } from "../i18n/translate";
import type { PluginRecord } from "../runtime/runtime";
import type { ShowcaseHost } from "./launch";
import type { ShowcaseOverlay } from "./overlay";
import {
  PauseController,
  ShowcaseAborted,
  sleep,
  throwIfAborted,
} from "./pause";

export { ShowcaseAborted };

/** Throw from a scenario to skip it gracefully (missing prerequisite). */
export class ScenarioSkipped extends Error {
  constructor(reason = "scenario skipped") {
    super(reason);
    this.name = "ScenarioSkipped";
  }
}

/** Raised by :meth:`ShowcaseContext.checkpoint`. */
export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointError";
  }
}

/** One showcase demo. Texts are functions so that they follow the current
 *  UI language. */
export interface ShowcaseScenario {
  /** Stable identifier, used by ``?showcase=<id>,…`` (e.g. ``"w1"``). */
  id: string;
  title(): string;
  subtitle?(): string;
  /** Optional warm-up, run once before the first demo of a page load (e.g.
   *  start the notebook kernel). */
  prewarm?(ctx: ShowcaseContext): Promise<void>;
  /** Play the demo. The workspace is empty and the Signals panel is shown. */
  run(ctx: ShowcaseContext): Promise<void>;
}

/** Element, CSS selector (first visible match) or element getter. */
export type Target = Element | string | (() => Element | null | undefined);

export interface Point {
  x: number;
  y: number;
}

export interface SayOptions {
  /** Caption position (default ``"bottom"``). */
  position?: "top" | "bottom";
}

export interface PointerOptions {
  /** Jump instead of gliding (no animation). */
  instant?: boolean;
}

export interface ShowcaseContextOptions {
  /** Pace multiplier (1 = normal); 0 selects the check mode. */
  speed: number;
  check?: boolean;
  /** Overlays (caption, cards, pointer); none in check mode. */
  overlay?: ShowcaseOverlay | null;
  pause?: PauseController;
  /** Aborts every wait when the showcase is quit. */
  signal?: AbortSignal;
}

/** Public deployment of DataLab Web and DataLab desktop website. */
export const PUBLIC_WEB_URL = "datalab-platform.com/web";
export const DESKTOP_URL = "datalab-platform.com";

const DEFAULT_TIMEOUT_MS = 15_000;
const ELLIPSIS = /\s*(?:…|\.\.\.)$/;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Rendered and not hidden (zero-size elements count as hidden). */
export function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected || !(el instanceof HTMLElement)) return false;
  if (el.getClientRects().length === 0) return false;
  return window.getComputedStyle(el).visibility !== "hidden";
}

function isDisabled(el: Element): boolean {
  return (
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute("aria-disabled") === "true"
  );
}

function describeElement(el: Element): string {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const cls = el.classList.length ? `.${[...el.classList].join(".")}` : "";
  return `<${el.tagName.toLowerCase()}${cls}>${text ? ` "${text}"` : ""}`;
}

function describeTarget(target: unknown): string {
  if (typeof target === "string") return `"${target}"`;
  if (target instanceof Element) return describeElement(target);
  return "a condition";
}

function cssString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function center(el: Element): Point {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function isPoint(target: unknown): target is Point {
  return (
    typeof target === "object" &&
    target !== null &&
    !(target instanceof Element) &&
    typeof (target as Partial<Point>).x === "number"
  );
}

function normalizeLabel(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().replace(ELLIPSIS, "");
}

/**
 * Whether a menu item (``li.menu-item``) matches ``name``: a string matches
 * the action id of leaf actions (``data-action-id``, e.g.
 * ``"create.signal.gauss"``), their menu path (``title`` ending with
 * ``/<name>``: canonical English for processing features, but generated
 * labels such as the Create entries follow the UI language) or the
 * displayed label, in English or translated by the app catalog (trailing
 * ellipsis ignored); a RegExp is tested against the displayed label.
 */
export function menuItemMatches(item: Element, name: string | RegExp): boolean {
  const label = normalizeLabel(
    item.querySelector(":scope > .menu-label")?.textContent,
  );
  if (typeof name !== "string") return name.test(label);
  if (item.getAttribute("data-action-id") === name.trim()) return true;
  const base = normalizeLabel(name);
  const path = item.getAttribute("title");
  if (path && (path === base || path.endsWith(`/${base}`))) return true;
  return label === base || label === normalizeLabel(t(base));
}

/** Parse a key combination such as ``"Control+k"`` or ``"Shift+Enter"``. */
export function parseKeys(keys: string): KeyboardEventInit {
  const parts = keys === "+" ? ["+"] : keys.split("+");
  const key = parts.pop() || keys;
  const mods = new Set(parts.map((part) => part.toLowerCase()));
  let code = key;
  if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`;
  else if (key === " ") code = "Space";
  return {
    key,
    code,
    ctrlKey: mods.has("control") || mods.has("ctrl"),
    shiftKey: mods.has("shift"),
    altKey: mods.has("alt"),
    metaKey: mods.has("meta"),
  };
}

function fire(
  el: Element,
  type: string,
  point: Point,
  init: MouseEventInit = {},
): void {
  const options: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
    button: 0,
    ...init,
  };
  if (type.startsWith("pointer")) {
    if (typeof PointerEvent === "function") {
      el.dispatchEvent(
        new PointerEvent(type, {
          ...options,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    }
  } else {
    el.dispatchEvent(new MouseEvent(type, options));
  }
}

/** ``el`` and its ancestors, up to (excluding) the first one containing
 *  ``stop``. */
function ancestorsOutside(el: Element, stop: Element | null): Element[] {
  const chain: Element[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (stop && node.contains(stop)) break;
    chain.push(node);
  }
  return chain;
}

/**
 * Dispatch the events of a real pointer moving from ``from`` to ``to``
 * (out/leave then over/enter). React derives ``onMouseEnter`` and
 * ``onMouseLeave`` from ``mouseout``/``mouseover`` and their
 * ``relatedTarget``, so hover-driven menus open as with a real mouse.
 */
export function dispatchHoverTransition(
  from: Element | null,
  to: Element | null,
  point: Point,
): void {
  const prev = from && from.isConnected ? from : null;
  const leave = { bubbles: false, cancelable: false, relatedTarget: to };
  const enter = { bubbles: false, cancelable: false, relatedTarget: prev };
  if (prev) {
    fire(prev, "pointerout", point, { relatedTarget: to });
    fire(prev, "mouseout", point, { relatedTarget: to });
    for (const el of ancestorsOutside(prev, to)) {
      fire(el, "pointerleave", point, leave);
      fire(el, "mouseleave", point, leave);
    }
  }
  if (to) {
    fire(to, "pointerover", point, { relatedTarget: prev });
    fire(to, "mouseover", point, { relatedTarget: prev });
    for (const el of ancestorsOutside(to, prev).reverse()) {
      fire(el, "pointerenter", point, enter);
      fire(el, "mouseenter", point, enter);
    }
  }
}

/**
 * Insert ``text`` at the caret of an input or textarea the way typing does:
 * native value setter (so React notices the change) and an ``input`` event.
 */
export function insertIntoField(
  field: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  let start = field.value.length;
  let end = start;
  try {
    start = field.selectionStart ?? start;
    end = field.selectionEnd ?? start;
  } catch {
    // Some input types (number, email) have no selection API.
  }
  const value = field.value.slice(0, start) + text + field.value.slice(end);
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  try {
    field.setSelectionRange(start + text.length, start + text.length);
  } catch {
    // No selection API: the caret stays at the end.
  }
  field.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: text,
      inputType: "insertText",
    }),
  );
}

/** Next animation frame, or ~40 ms when the browser does not paint (hidden
 *  or occluded window, where ``requestAnimationFrame`` stalls). */
function nextFrame(signal?: AbortSignal): Promise<void> {
  if (document.hidden || typeof requestAnimationFrame !== "function") {
    return sleep(16, signal);
  }
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 40);
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      resolve();
    });
  }).then(() => throwIfAborted(signal));
}

// ---------------------------------------------------------------------------
// Showcase context
// ---------------------------------------------------------------------------

/** Everything a scenario needs to play a readable live demo. */
export class ShowcaseContext {
  readonly host: ShowcaseHost;
  /** Pace multiplier (0 in check mode). */
  readonly speed: number;
  /** Check mode: no pauses, no overlays, no pointer animation. */
  readonly check: boolean;
  readonly pause: PauseController;
  readonly signal: AbortSignal | undefined;
  /** Scenario being played (set by the player). */
  scenario: ShowcaseScenario | null = null;

  private readonly overlay: ShowcaseOverlay | null;
  private stepCount = 0;
  private pointer: Point | null = null;
  private hovered: Element | null = null;
  /** Mouse buttons held during a :meth:`drag` (``buttons`` of the moves). */
  private buttons = 0;

  constructor(host: ShowcaseHost, opts: ShowcaseContextOptions) {
    this.host = host;
    this.check = opts.check === true || opts.speed === 0;
    this.speed = this.check ? 0 : Math.max(0.05, opts.speed);
    this.overlay = this.check ? null : (opts.overlay ?? null);
    this.pause = opts.pause ?? new PauseController();
    this.signal = opts.signal;
  }

  log(message: string): void {
    const tag = this.scenario ? `showcase:${this.scenario.id}` : "showcase";
    console.info(`[${tag}] ${message}`);
  }

  // -- Timing ----------------------------------------------------------------

  /** Readable pause of ``ms`` (scaled by the pace; none in check mode).
   *  Frozen while the operator has paused the showcase (F9). */
  async hold(ms = 750): Promise<void> {
    if (this.check) {
      throwIfAborted(this.signal);
      return;
    }
    await this.pause.hold(ms * this.speed, this.signal);
  }

  /** Short real delay letting React re-render after an event. */
  private settle(): Promise<void> {
    return sleep(this.check ? 30 : 60, this.signal);
  }

  /**
   * Wait until ``target`` is satisfied: a CSS selector resolves to its first
   * visible match, a function to its first truthy result (polled every
   * 50 ms). Throws after ``timeoutMs``.
   */
  async waitFor(
    target: string,
    timeoutMs?: number,
    description?: string,
  ): Promise<HTMLElement>;
  async waitFor<T>(
    target: () => T | null | undefined | false,
    timeoutMs?: number,
    description?: string,
  ): Promise<T>;
  async waitFor<T>(
    target: string | (() => T | null | undefined | false),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    description?: string,
  ): Promise<T | HTMLElement> {
    const probe =
      typeof target === "string" ? () => this.visible(target) : target;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      throwIfAborted(this.signal);
      const value = probe();
      if (value) return value;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs} ms waiting for ` +
            (description ?? describeTarget(target)),
        );
      }
      await sleep(50, this.signal);
    }
  }

  /**
   * Fail the demo with ``message`` unless ``condition`` holds (a function
   * may be async; with ``timeoutMs``, it is polled until then).
   */
  async checkpoint(
    condition: boolean | (() => unknown),
    message: string,
    timeoutMs = 0,
  ): Promise<void> {
    const probe = typeof condition === "function" ? condition : () => condition;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      throwIfAborted(this.signal);
      let ok: boolean;
      try {
        ok = Boolean(await probe());
      } catch {
        ok = false;
      }
      if (ok) return;
      if (Date.now() >= deadline) throw new CheckpointError(message);
      await sleep(100, this.signal);
    }
  }

  // -- Captions, cards, spotlight ----------------------------------------------

  /** Show (or update) the caption banner, then hold ``holdMs``. */
  async say(text: string, holdMs = 2500, opts: SayOptions = {}): Promise<void> {
    this.stepCount += 1;
    this.log(text);
    if (this.overlay) {
      const head = this.scenario
        ? `${this.scenario.title()}  ·  ${t("Step {n}", { n: this.stepCount })}`
        : "";
      this.overlay.caption(head, text, { position: opts.position });
    }
    await this.hold(holdMs);
  }

  /** Discreet caption (e.g. a demo failed and the showcase moves on). */
  async notice(text: string, holdMs = 2500): Promise<void> {
    this.log(text);
    this.overlay?.caption("", text, { position: "top", notice: true });
    await this.hold(holdMs);
    this.overlay?.clearCaption();
  }

  clearCaption(): void {
    this.overlay?.clearCaption();
  }

  /** Persistent label for the rest of the current demo (e.g. to flag a
   *  simulated session), kept across captions and removed when the demo
   *  ends; ``null`` removes it earlier. */
  label(text: string | null): void {
    if (text) this.log(`label: ${text}`);
    this.overlay?.sticker(text);
  }

  /** Full-screen title card for ``holdMs``; ``during`` runs while it is
   *  shown (the player resets the workspace behind it). */
  async titleCard(
    title: string,
    subtitle?: string,
    holdMs = 3000,
    during?: () => Promise<void>,
  ): Promise<void> {
    this.log(`title card: ${title}`);
    if (!this.overlay) {
      if (during) await during();
      return;
    }
    this.overlay.clearCaption();
    this.overlay.clearSpotlight();
    this.overlay.card({
      kicker: t("DataLab Web · live demo"),
      title,
      subtitle,
    });
    try {
      const started = Date.now();
      if (during) await during();
      const elapsed = (Date.now() - started) / this.speed;
      await this.hold(Math.max(0, holdMs - elapsed));
    } finally {
      await this.overlay.clearCard(450);
    }
  }

  /** Closing card of a loop: where to try DataLab Web and DataLab desktop
   *  (``keep`` leaves it on screen, e.g. while the window closes). */
  async endCard(holdMs = 5000, opts: { keep?: boolean } = {}): Promise<void> {
    this.log(`end card: ${PUBLIC_WEB_URL} • ${DESKTOP_URL}`);
    if (!this.overlay) return;
    this.overlay.clearAll();
    this.overlay.card({
      kicker: "DataLab",
      title: t("Try DataLab Web now"),
      subtitle: PUBLIC_WEB_URL,
      note: t("DataLab desktop: {url}", { url: DESKTOP_URL }),
    });
    let kept = false;
    try {
      await this.hold(holdMs);
      kept = opts.keep === true;
    } finally {
      if (!kept) await this.overlay.clearCard(450);
    }
  }

  /** Dim everything but ``target`` (its bounding box at call time). */
  async spotlight(target: Target, padding = 8): Promise<void> {
    const el = await this.find(target);
    if (!this.overlay) return;
    const rect = el.getBoundingClientRect();
    this.overlay.spotlight({
      x: rect.left - padding,
      y: rect.top - padding,
      width: rect.width + 2 * padding,
      height: rect.height + 2 * padding,
    });
  }

  clearSpotlight(): void {
    this.overlay?.clearSpotlight();
  }

  // -- DOM queries -------------------------------------------------------------

  $<E extends Element = HTMLElement>(
    selector: string,
    root: ParentNode = document,
  ): E | null {
    return root.querySelector<E>(selector);
  }

  $$<E extends Element = HTMLElement>(
    selector: string,
    root: ParentNode = document,
  ): E[] {
    return [...root.querySelectorAll<E>(selector)];
  }

  /** First visible element matching ``selector``. */
  visible(selector: string, root: ParentNode = document): HTMLElement | null {
    return this.$$(selector, root).find(isVisible) ?? null;
  }

  /** Resolve ``target`` to a visible element, waiting up to ``timeoutMs``. */
  async find(
    target: Target,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<HTMLElement> {
    if (typeof target === "string") return this.waitFor(target, timeoutMs);
    const get = target instanceof Element ? () => target : target;
    return this.waitFor(
      () => {
        const el = get();
        return isVisible(el) ? el : null;
      },
      timeoutMs,
      describeTarget(target),
    );
  }

  // -- Pointer and keyboard -------------------------------------------------

  /** Glide the fake pointer to the centre of ``target`` (hovering what it
   *  crosses, like a real mouse). */
  async moveTo(
    target: Target | Point,
    opts: PointerOptions = {},
  ): Promise<void> {
    let to: Point;
    if (isPoint(target)) {
      to = target;
    } else {
      const el = await this.find(target);
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      to = center(el);
    }
    if (!this.overlay || opts.instant) {
      this.pointerAt(to);
      return;
    }
    await this.glide(to);
  }

  /** Move onto ``target`` (opens hover-driven submenus). */
  async hover(target: Target, opts: PointerOptions = {}): Promise<void> {
    await this.moveTo(target, opts);
    await this.settle();
  }

  /** Move to ``target`` visibly and click it: pointer and mouse events with
   *  real coordinates, then ``click`` (a ripple marks it on screen). */
  async click(target: Target, opts: PointerOptions = {}): Promise<void> {
    const el = await this.find(target);
    if (isDisabled(el)) {
      throw new Error(
        `Cannot click a disabled element: ${describeElement(el)}`,
      );
    }
    await this.moveTo(el, opts);
    if (this.overlay && !opts.instant) await this.hold(140);
    const point = this.pointer ?? center(el);
    this.overlay?.ripple(point.x, point.y);
    fire(el, "pointerdown", point, { buttons: 1 });
    fire(el, "mousedown", point, { buttons: 1, detail: 1 });
    el.closest<HTMLElement>(
      "input, textarea, select, button, a[href], [tabindex], [contenteditable='true']",
    )?.focus({ preventScroll: true });
    fire(el, "pointerup", point);
    fire(el, "mouseup", point, { detail: 1 });
    fire(el, "click", point, { detail: 1 });
    await this.settle();
  }

  /**
   * Click at ``point`` (viewport coordinates) like a real mouse, for plots
   * and canvases where the position matters: the press and the release go
   * to the topmost application element under the pointer at that time (a
   * drag layer added on press, as Plotly does, receives the release) and
   * ``click`` to their nearest common ancestor.
   */
  async clickAt(point: Point, opts: PointerOptions = {}): Promise<void> {
    await this.moveTo(point, opts);
    if (this.overlay && !opts.instant) await this.hold(140);
    this.overlay?.ripple(point.x, point.y);
    const down = this.buttonDown(point);
    this.buttonUp(point, down);
    await this.settle();
  }

  /**
   * Drag like a real mouse: press at ``from``, glide to ``to`` (through
   * each point of a path) with the button held, release. Draws a shape on
   * a plot or moves a handle; targets resolve to their centre.
   */
  async drag(
    from: Target | Point,
    to: Target | Point | Point[],
    opts: PointerOptions = {},
  ): Promise<void> {
    const start = isPoint(from) ? from : center(await this.find(from));
    await this.moveTo(start, opts);
    if (this.overlay && !opts.instant) await this.hold(200);
    const path = Array.isArray(to) ? to : [to];
    const down = this.buttonDown(start);
    let end = start;
    try {
      await this.settle();
      for (const step of path) {
        end = isPoint(step) ? step : center(await this.find(step));
        await this.moveTo(end, opts);
      }
      if (this.overlay && !opts.instant) await this.hold(150);
    } finally {
      this.buttonUp(end, down);
    }
    await this.settle();
  }

  /**
   * Click ``target`` and type ``text`` at ``cps`` characters per second
   * (scaled by the pace; at once in check mode). CodeMirror editors (macros,
   * notebook cells) are fed through their ``EditorView``: the text is
   * inserted verbatim (no auto-indent, no auto-closed brackets).
   */
  async type(target: Target, text: string, cps = 18): Promise<void> {
    const el = await this.find(target);
    await this.click(el);
    const insert = this.inserter(el);
    if (this.check) {
      insert(text);
      // Let React re-render before the next action reads the new text.
      await this.settle();
      return;
    }
    const delay = (1000 / Math.max(1, cps)) * this.speed;
    for (const char of Array.from(text)) {
      insert(char);
      await this.pause.hold(delay, this.signal);
    }
  }

  /** Press a key combination (e.g. ``"Escape"``, ``"Control+k"``,
   *  ``"Shift+Enter"``) on ``target`` or the focused element. */
  async press(keys: string, target?: Target): Promise<void> {
    let el: Element = target
      ? await this.find(target)
      : (document.activeElement ?? document.body);
    const editor = el.closest(".cm-editor");
    if (editor) el = editor.querySelector(".cm-content") ?? el;
    const init: KeyboardEventInit = {
      ...parseKeys(keys),
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    await this.settle();
  }

  /** Choose ``value`` in a ``<select>`` element. */
  async select(target: Target, value: string): Promise<void> {
    const el = await this.find(target);
    if (!(el instanceof HTMLSelectElement)) {
      throw new Error(`Not a <select>: ${describeElement(el)}`);
    }
    await this.click(el);
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await this.settle();
  }

  // -- Menus, dialogs, tabs, actions ------------------------------------------

  /** Top-level menu by its canonical (English) key, e.g. ``"Processing"``. */
  topMenu(key: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      `[data-menu-top="${cssString(key)}"]`,
    );
  }

  /** Open a top-level menu (same logic as the ``openTopMenu`` helper of the
   *  end-to-end demos: hover first, click only if it did not open). */
  async openTopMenu(key: string): Promise<void> {
    const top = await this.find(() => this.topMenu(key));
    await this.moveTo(top);
    await this.settle();
    if (top.getAttribute("aria-expanded") !== "true") {
      await this.click(top, { instant: true });
    }
    if (top.getAttribute("aria-haspopup") === "true") {
      await this.waitFor(
        () => top.querySelector(":scope > .menu-dropdown"),
        5_000,
        `the ${key} menu to open`,
      );
    }
  }

  /** First visible item of the open menus matching ``name`` (see
   *  :func:`menuItemMatches`), searched in the submenu of ``parent`` (a
   *  top-level menu or a submenu item) or in every open menu. */
  menuItem(name: string | RegExp, parent?: Element): HTMLElement | null {
    const items = parent
      ? this.$$(":scope > .menu-dropdown > li.menu-item", parent)
      : this.$$(".menu-dropdown > li.menu-item");
    return (
      items.find((item) => isVisible(item) && menuItemMatches(item, name)) ??
      null
    );
  }

  /**
   * Open the ``topKey`` menu, hover the intermediate submenus and click the
   * last item, e.g. ``clickMenuPath("Processing", "Fourier analysis",
   * "FFT")``. Without items, clicks the top-level entry itself.
   */
  async clickMenuPath(
    topKey: string,
    ...items: (string | RegExp)[]
  ): Promise<void> {
    if (items.length === 0) {
      await this.click(() => this.topMenu(topKey));
      return;
    }
    await this.openTopMenu(topKey);
    await this.hold(350);
    let parent: HTMLElement = await this.find(() => this.topMenu(topKey));
    for (let level = 0; level < items.length; level++) {
      const scope = parent;
      const item = await this.find(
        () => this.menuItem(items[level], scope),
        5_000,
      );
      if (this.overlay) await this.approachMenuItem(item, level);
      if (level === items.length - 1) {
        await this.click(item);
      } else {
        await this.hover(item, { instant: true });
        await this.waitFor(
          () => item.getAttribute("aria-expanded") === "true",
          3_000,
          `the "${String(items[level])}" submenu to open`,
        );
        await this.hold(450);
        parent = item;
      }
    }
  }

  /** Confirm the parameter dialog (DataSet or processing dialog) if one
   *  opens within ``timeoutMs``. Returns whether a dialog was confirmed. */
  async confirmDialogIfAny(timeoutMs = 4_000): Promise<boolean> {
    const selector = ".dataset-dialog, .processing-dataset-dialog";
    let dialog: HTMLElement;
    try {
      dialog = await this.waitFor(selector, timeoutMs);
    } catch (error) {
      if (error instanceof ShowcaseAborted) throw error;
      return false;
    }
    await this.hold(600);
    const ok = this.$$("button", dialog).find((button) =>
      [t("OK"), "OK"].includes((button.textContent ?? "").trim()),
    );
    if (!ok) throw new Error("The parameter dialog has no OK button");
    await this.click(ok);
    await this.waitFor(() => !isVisible(dialog), 15_000, "the dialog to close");
    return true;
  }

  /** Tab by its English label, in any UI language: panels (``"Signals"``,
   *  ``"Images"``), central views (``"Plot"``, ``"Macros"``,
   *  ``"Notebooks"``) and side panels (``"Properties"``…). */
  tab(name: string): HTMLElement | null {
    const labels = [name, t(name)];
    return (
      this.$$('[role="tab"]').find(
        (tab) =>
          isVisible(tab) && labels.includes((tab.textContent ?? "").trim()),
      ) ?? null
    );
  }

  async clickTab(name: string, opts: PointerOptions = {}): Promise<void> {
    await this.click(() => this.tab(name), opts);
  }

  /** Run an action of the application registry by id (menus, toolbar and
   *  command palette share it), without a visible menu walk. */
  async runAction(actionId: string): Promise<void> {
    const action = this.host.getActions().find((a) => a.id === actionId);
    if (!action) throw new Error(`Unknown action "${actionId}"`);
    if (!action.enabled(this.host.getActionState())) {
      throw new Error(`Action "${actionId}" is disabled`);
    }
    this.log(`action ${actionId}`);
    await action.run();
    await this.settle();
  }

  /** Loaded application plugins (``capabilities`` include "application"). */
  applications(): PluginRecord[] {
    return this.host
      .getPluginRecords()
      .filter(
        (record) =>
          record.loaded &&
          record.enabled &&
          (record.info?.capabilities ?? []).includes("application"),
      );
  }

  // -- Workspace ---------------------------------------------------------------

  /**
   * Bring the application back to a clean state: close menus, the command
   * palette and dialogs, empty the workspace as a new one (signals, images,
   * groups, macros, notebooks, provenance, selection; untitled and
   * unmodified, Python workers kept warm — see
   * :meth:`ShowcaseHost.resetWorkspace`), then show the plot view of the
   * Signals panel.
   */
  async resetWorkspace(): Promise<void> {
    // Keep the title card: the player resets the workspace behind it.
    this.overlay?.clearCaption();
    this.overlay?.clearSpotlight();
    await this.closeTransientUi();
    await this.host.resetWorkspace();
    for (const name of ["Plot", "Images", "Signals"]) {
      const tab = this.tab(name);
      if (tab) await this.click(tab, { instant: true });
    }
    await this.waitFor(
      () => document.querySelectorAll(".object-tree-item").length === 0,
      10_000,
      "an empty object tree",
    );
  }

  // -- Player hooks --------------------------------------------------------------

  beginScenario(scenario: ShowcaseScenario): void {
    this.scenario = scenario;
    this.stepCount = 0;
  }

  endScenario(): void {
    this.overlay?.clearAll();
    this.scenario = null;
  }

  // -- Internals -------------------------------------------------------------------

  private pointerAt(point: Point): void {
    this.pointer = point;
    this.overlay?.cursor(point.x, point.y);
    const el = this.elementAt(point);
    if (el !== this.hovered) {
      dispatchHoverTransition(this.hovered, el, point);
      this.hovered = el;
    }
    if (el) {
      fire(el, "pointermove", point, { buttons: this.buttons });
      fire(el, "mousemove", point, { buttons: this.buttons });
    }
  }

  /** Topmost application element under ``point`` (overlays excluded). */
  private elementAt(point: Point): Element | null {
    if (typeof document.elementsFromPoint !== "function") return null;
    return (
      document
        .elementsFromPoint(point.x, point.y)
        .find((el) => !this.overlay?.contains(el)) ?? null
    );
  }

  /** Press the left button at ``point``; returns the pressed element. */
  private buttonDown(point: Point): Element {
    const el = this.elementAt(point) ?? document.body;
    fire(el, "pointerdown", point, { buttons: 1 });
    fire(el, "mousedown", point, { buttons: 1, detail: 1 });
    this.buttons = 1;
    return el;
  }

  /** Release the button at ``point`` on the element now under it, then
   *  ``click`` the nearest common ancestor of ``down`` and that element
   *  (as browsers do). */
  private buttonUp(point: Point, down: Element): void {
    this.buttons = 0;
    const up = this.elementAt(point) ?? down;
    fire(up, "pointerup", point);
    fire(up, "mouseup", point, { detail: 1 });
    let common: Element | null = down.isConnected ? down : null;
    while (common && !common.contains(up)) common = common.parentElement;
    if (common) fire(common, "click", point, { detail: 1 });
  }

  /** Ease-in-out pointer motion, one step per animation frame. */
  private async glide(to: Point): Promise<void> {
    const from = this.pointer ?? {
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.62,
    };
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = Math.min(900, Math.max(220, distance * 0.9)) * this.speed;
    const started = performance.now();
    for (;;) {
      await nextFrame(this.signal);
      await this.pause.waitWhilePaused(this.signal);
      const progress = Math.min(1, (performance.now() - started) / duration);
      const eased =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - (-2 * progress + 2) ** 2 / 2;
      this.pointerAt({
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      });
      if (progress >= 1) return;
    }
  }

  /** Menu-friendly path: a straight line would cross sibling rows and close
   *  the submenu being entered, so go down the dropdown first (top level),
   *  or across into the submenu first (nested levels). */
  private async approachMenuItem(
    item: HTMLElement,
    level: number,
  ): Promise<void> {
    const target = center(item);
    const from = this.pointer ?? target;
    if (level === 0) {
      await this.glide({ x: from.x, y: target.y });
    } else {
      const box = item.getBoundingClientRect();
      const inset = Math.min(18, box.width / 4);
      const entryX = box.left > from.x ? box.left + inset : box.right - inset;
      await this.glide({ x: entryX, y: from.y });
      await this.glide({ x: entryX, y: target.y });
    }
    await this.glide(target);
  }

  private inserter(el: HTMLElement): (text: string) => void {
    const editor = el.closest(".cm-editor") ?? el.querySelector(".cm-editor");
    if (editor) {
      const view = EditorView.findFromDOM(editor as HTMLElement);
      if (!view) throw new Error("No CodeMirror editor view for the target");
      view.focus();
      // Rendered at once, as for real key strokes: an editor synced from
      // React state (notebook cells) must never lag behind and drop text.
      return (text) =>
        flushSync(() =>
          view.dispatch(view.state.replaceSelection(text), {
            userEvent: "input.type",
            scrollIntoView: true,
          }),
        );
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      return (text) => insertIntoField(el, text);
    }
    if (el.isContentEditable) {
      el.focus();
      return (text) => {
        document.execCommand("insertText", false, text);
      };
    }
    throw new Error(`Cannot type into ${describeElement(el)}`);
  }

  private transientUi(): HTMLElement[] {
    return this.$$(
      '.menu-dropdown, [role="dialog"], .command-palette-input',
    ).filter(isVisible);
  }

  private async closeTransientUi(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.transientUi().length === 0) return;
      await this.press("Escape");
      await sleep(150, this.signal);
    }
    const modal = this.visible('.overlay[role="dialog"]');
    if (modal) {
      const labels = [t("Cancel"), t("Close"), "Cancel", "Close"];
      const close = this.$$("button", modal).find((button) =>
        labels.includes((button.textContent ?? "").trim()),
      );
      if (close) await this.click(close, { instant: true });
    }
    if (this.transientUi().length > 0) {
      this.log("some dialog did not close; continuing anyway");
    }
  }
}
