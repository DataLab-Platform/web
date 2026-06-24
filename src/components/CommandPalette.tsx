import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionDescriptor,
  ActionState,
  CommandEntry,
} from "../actions/types";
import { buildMenuTree, flattenMenuLeaves } from "../actions/buildMenu";
import { fuzzyMatch } from "../actions/commandSearch";
import { t } from "../i18n/translate";

interface Props {
  /** Whether the palette is currently shown. */
  open: boolean;
  /** Close the palette (Escape, backdrop click, or after running). */
  onClose: () => void;
  /** Full, flat action registry (same list as the menu bar). */
  actions: ActionDescriptor[];
  /** Live action state driving each command's enablement. */
  state: ActionState;
}

/** VSCode-style command palette: a searchable overlay listing every menu
 *  command by its localised path, with keyboard navigation. Opened from
 *  the menu-bar button or a global shortcut (Ctrl/Cmd+K). */
export function CommandPalette({ open, onClose, actions, state }: Props) {
  const entries = useMemo(
    () => flattenMenuLeaves(buildMenuTree(actions)),
    [actions],
  );
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Reset and focus the input each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const results = useMemo<CommandEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...entries].sort((a, b) =>
        a.pathLabel.localeCompare(b.pathLabel),
      );
    }
    return entries
      .map((entry) => ({ entry, m: fuzzyMatch(q, entry.searchText) }))
      .filter((r) => r.m.matched)
      .sort(
        (a, b) =>
          b.m.score - a.m.score ||
          a.entry.pathLabel.localeCompare(b.entry.pathLabel),
      )
      .map((r) => r.entry);
  }, [entries, query]);

  // Keep the highlighted index within bounds as results shrink/grow.
  useEffect(() => {
    setHighlight((h) =>
      results.length === 0 ? 0 : Math.min(h, results.length - 1),
    );
  }, [results]);

  // Scroll the highlighted row into view on keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, results]);

  if (!open) return null;

  const runAt = (index: number): void => {
    const entry = results[index];
    if (!entry || !entry.action.enabled(state)) return;
    onClose();
    void entry.action.run();
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (results.length ? (h + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) =>
        results.length ? (h - 1 + results.length) % results.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(highlight);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="overlay command-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("Command palette")}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          value={query}
          placeholder={t("Type to search for a command…")}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={
            results.length ? `command-palette-option-${highlight}` : undefined
          }
        />
        {results.length === 0 ? (
          <div className="command-palette-empty">
            {t("No matching commands")}
          </div>
        ) : (
          <ul
            id="command-palette-list"
            ref={listRef}
            className="command-palette-list"
            role="listbox"
          >
            {results.map((entry, index) => {
              const enabled = entry.action.enabled(state);
              const active = index === highlight;
              return (
                <li
                  key={entry.action.id}
                  id={`command-palette-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={active}
                  aria-disabled={!enabled}
                  className={
                    "command-palette-item" +
                    (active ? " command-palette-item--active" : "") +
                    (enabled ? "" : " command-palette-item--disabled")
                  }
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runAt(index)}
                >
                  {entry.action.iconUrl ? (
                    <img
                      className="command-palette-icon"
                      src={entry.action.iconUrl}
                      alt=""
                      aria-hidden
                    />
                  ) : (
                    <span className="command-palette-icon" aria-hidden />
                  )}
                  <span className="command-palette-label">{entry.label}</span>
                  {entry.parentLabel && (
                    <span className="command-palette-path">
                      {entry.parentLabel}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
