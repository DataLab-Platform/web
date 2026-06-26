import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/DataLab.svg";
import type { ActionDescriptor, ActionState } from "../actions/types";
import { buildMenuTree } from "../actions/buildMenu";
import { MenuDropdown } from "./MenuDropdown";
import { ConsoleStatusIndicator } from "./ConsoleStatusIndicator";
import { MemoryUsageIndicator } from "./MemoryUsageIndicator";
import { useTheme } from "../utils/theme";
import { t } from "../i18n/translate";
import type { RuntimeApi } from "../runtime/runtime";

interface Props {
  status: string;
  statusKind: "loading" | "ready" | "error";
  state: ActionState;
  actions: ActionDescriptor[];
  /** Callback invoked when the user clicks the "Beta" badge
   *  (typically opens the About dialog). */
  onShowExperimentalInfo?: () => void;
  /** Callback invoked when the user clicks the console-status indicator;
   *  typically opens the Help > Browser console log dialog. */
  onOpenConsole?: () => void;
  /** Live runtime, used by the memory-usage indicator to sample the
   *  WASM heap. When ``undefined``/``null`` the indicator is hidden. */
  runtime?: RuntimeApi | null;
  /** Invoked when the user picks "Free memory" in the indicator's
   *  dropdown to reclaim memory (garbage-collection pass). When omitted
   *  the menu item is shown read-only (no action). */
  onFreeMemory?: () => void | Promise<void>;
  /** Current value of the "store data on disk" preference (checkmark on
   *  the indicator's dropdown toggle). */
  storeOnDisk?: boolean;
  /** True while a storage-mode switch is in progress (disables the
   *  toggle item). */
  storageBusy?: boolean;
  /** Whether the on-disk storage mode is available (OPFS + secure
   *  context). When false the toggle item is disabled. */
  diskStorageSupported?: boolean;
  /** Toggle on-disk storage mode. When omitted the toggle item is
   *  hidden. */
  onToggleStoreOnDisk?: () => void | Promise<void>;
  /** Current visibility of the AI Assistant panel. When ``undefined``
   *  the toggle button is hidden (used by surfaces that don't expose
   *  the assistant). */
  aiPanelVisible?: boolean;
  /** Toggle handler for the AI Assistant panel. Required to render
   *  the toggle button. */
  onToggleAIPanel?: () => void;
  /** Open the command palette. When omitted the trigger button is
   *  hidden. */
  onOpenCommandPalette?: () => void;
}

export function MenuBar(props: Props) {
  const {
    status,
    statusKind,
    state,
    actions,
    onShowExperimentalInfo,
    onOpenConsole,
    runtime,
    onFreeMemory,
    storeOnDisk,
    storageBusy,
    diskStorageSupported,
    onToggleStoreOnDisk,
    aiPanelVisible,
    onToggleAIPanel,
    onOpenCommandPalette,
  } = props;
  const tree = useMemo(() => buildMenuTree(actions), [actions]);
  const [openTop, setOpenTop] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (openTop === null) return;
    const handleDown = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenTop(null);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenTop(null);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openTop]);

  return (
    <div className="menubar" ref={barRef}>
      <div className="menubar-brand">
        <img className="menubar-logo" src={logoUrl} alt="" aria-hidden="true" />
        <h1>DataLab</h1>
        <button
          type="button"
          className="experimental-badge"
          onClick={onShowExperimentalInfo}
          title={t("DataLab-Web is currently in beta — click for details")}
          aria-label={t("DataLab-Web is currently in beta — click for details")}
        >
          Beta
        </button>
      </div>
      <nav className="menubar-nav" role="menubar">
        {tree.map((node) => {
          const isOpen = openTop === node.label;
          return (
            <div
              key={node.label}
              className={"menubar-top" + (isOpen ? " open" : "")}
              role="menuitem"
              data-menu-top={node.label}
              aria-haspopup="true"
              aria-expanded={isOpen}
              onClick={(event) => {
                event.stopPropagation();
                setOpenTop((c) => (c === node.label ? null : node.label));
              }}
              onMouseEnter={() => {
                if (openTop !== null) setOpenTop(node.label);
              }}
            >
              <span className="menubar-top-label">{node.displayLabel}</span>
              {isOpen && node.children && node.children.length > 0 && (
                <MenuDropdown
                  nodes={node.children}
                  state={state}
                  onClose={() => setOpenTop(null)}
                />
              )}
            </div>
          );
        })}
      </nav>
      {onOpenCommandPalette && (
        <CommandPaletteButton onOpen={onOpenCommandPalette} />
      )}
      <span className="spacer" />
      <span
        className="status"
        style={{ color: statusKind === "error" ? "#f48771" : undefined }}
      >
        {status}
      </span>
      {onOpenConsole && <ConsoleStatusIndicator onOpen={onOpenConsole} />}
      {runtime && (
        <MemoryUsageIndicator
          runtime={runtime}
          onRequestFreeMemory={onFreeMemory}
          storeOnDisk={storeOnDisk}
          storageBusy={storageBusy}
          diskStorageSupported={diskStorageSupported}
          onToggleStoreOnDisk={onToggleStoreOnDisk}
        />
      )}
      {onToggleAIPanel && (
        <AIToggleButton visible={!!aiPanelVisible} onToggle={onToggleAIPanel} />
      )}
      <ThemeToggleButton />
    </div>
  );
}

/** Command-palette trigger, mirroring the visual weight of the other
 *  menu-bar icon buttons. Clicking opens the searchable palette; the
 *  same palette is reachable via the global Ctrl/Cmd+K shortcut. */
function CommandPaletteButton({ onOpen }: { onOpen: () => void }) {
  const shortcut = isMacPlatform() ? "⌘K" : "Ctrl+K";
  const label = t("Command palette");
  return (
    <button
      type="button"
      className="menubar-command-palette"
      onClick={onOpen}
      title={`${label} (${shortcut})`}
      aria-label={label}
    >
      <svg
        className="menubar-command-palette__icon"
        width={15}
        height={15}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable={false}
      >
        <circle cx={11} cy={11} r={7} />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <span className="menubar-command-palette__shortcut">{shortcut}</span>
    </button>
  );
}

/** Best-effort macOS detection so the palette shortcut hint reads "⌘K"
 *  on Apple keyboards and "Ctrl+K" elsewhere. */
function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(
    navigator.platform || navigator.userAgent,
  );
}

/** AI Assistant show/hide toggle, rendered next to the theme toggle.
 *  The pressed state mirrors :prop:`visible` so screen readers and
 *  visual styling stay in sync with the panel itself. */
function AIToggleButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const label = visible ? t("Hide AI Assistant") : t("Show AI Assistant");
  return (
    <button
      type="button"
      className={
        "menubar-ai-toggle" + (visible ? " menubar-ai-toggle--active" : "")
      }
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={visible}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable={false}
      >
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12z" />
        <path d="M9 11h.01M12 11h.01M15 11h.01" />
      </svg>
    </button>
  );
}

/** Light/dark theme toggle, wired to the persistent ``useTheme`` hook. */
function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? t("Switch to light theme") : t("Switch to dark theme");
  return (
    <button
      type="button"
      className="menubar-theme-toggle"
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      {isDark ? "\u263C" : "\u263E"}
    </button>
  );
}
