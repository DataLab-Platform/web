/**
 * Bash-style input history for the AI Assistant chat input.
 *
 * Mirrors :mod:`DataLab/datalab/aiassistant/inputhistory.py`. Provides
 * Ctrl+Up/Down navigation through previously submitted prompts and
 * persists to ``localStorage`` so history survives across sessions
 * (DataLab Qt uses an on-disk text file).
 */

const STORAGE_KEY = "datalab-web.aiassistant.inputHistory";

export class InputHistory {
  private items: string[] = [];
  /** Index of the entry currently displayed when navigating; ``null``
   *  means the user is editing a fresh draft. */
  private index: number | null = null;
  /** Draft preserved when the user starts navigating, restored when
   *  navigating past the most recent entry. */
  private draft = "";
  private readonly maxSize: number;
  private readonly storageKey: string;

  constructor(maxSize = 500, storageKey = STORAGE_KEY) {
    this.maxSize = Math.max(1, Math.floor(maxSize));
    this.storageKey = storageKey;
    this.load();
  }

  private load(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.items = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const trimmed = this.items.slice(-this.maxSize);
      localStorage.setItem(this.storageKey, JSON.stringify(trimmed));
    } catch {
      /* quota or disabled storage — silently ignore */
    }
  }

  /** Snapshot (oldest first). */
  getItems(): string[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
    this.resetNavigation();
    this.save();
  }

  /** Append a submitted prompt; deduplicates and trims to ``maxSize``. */
  add(text: string): void {
    const trimmed = text.replace(/\n+$/, "");
    if (!trimmed.trim()) return;
    this.items = this.items.filter((it) => it !== trimmed);
    this.items.push(trimmed);
    if (this.items.length > this.maxSize) {
      this.items = this.items.slice(-this.maxSize);
    }
    this.resetNavigation();
    this.save();
  }

  /** Forget the current navigation position and any preserved draft. */
  resetNavigation(): void {
    this.index = null;
    this.draft = "";
  }

  /** Return the previous (older) entry, or ``null`` if none. Captures the
   *  current draft on the first call so it can be restored later. */
  previous(currentText: string): string | null {
    if (this.items.length === 0) return null;
    if (this.index === null) {
      this.draft = currentText;
      this.index = this.items.length - 1;
    } else if (this.index > 0) {
      this.index -= 1;
    } else {
      return this.items[this.index];
    }
    return this.items[this.index];
  }

  /** Return the next (newer) entry; restores the draft past the end.
   *  ``null`` when no navigation is in progress. */
  next(): string | null {
    if (this.index === null) return null;
    if (this.index < this.items.length - 1) {
      this.index += 1;
      return this.items[this.index];
    }
    this.index = null;
    const draft = this.draft;
    this.draft = "";
    return draft;
  }
}
