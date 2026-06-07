import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/DataLab.svg";
import type { ActionDescriptor, ActionState } from "../actions/types";
import { buildMenuTree } from "../actions/buildMenu";
import { MenuDropdown } from "./MenuDropdown";
import { ConsoleStatusIndicator } from "./ConsoleStatusIndicator";
import { MemoryUsageIndicator } from "./MemoryUsageIndicator";
import { useTheme } from "../utils/theme";
import { t } from "../i18n/translate";
import { useTranslation } from "../i18n/I18nProvider";
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
  /** Invoked when the user clicks the memory indicator to reclaim
   *  memory (garbage-collection pass). When omitted the indicator is
   *  shown read-only (no click action). */
  onFreeMemory?: () => void | Promise<void>;
  /** Current visibility of the AI Assistant panel. When ``undefined``
   *  the toggle button is hidden (used by surfaces that don't expose
   *  the assistant). */
  aiPanelVisible?: boolean;
  /** Toggle handler for the AI Assistant panel. Required to render
   *  the toggle button. */
  onToggleAIPanel?: () => void;
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
    aiPanelVisible,
    onToggleAIPanel,
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
        <h1>DataLab Web</h1>
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
        />
      )}
      {onToggleAIPanel && (
        <AIToggleButton visible={!!aiPanelVisible} onToggle={onToggleAIPanel} />
      )}
      <LanguageSelector />
      <ThemeToggleButton />
    </div>
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

/** Small inline flag icon for a locale. Uses SVG rather than flag emoji
 *  because Windows does not render regional-indicator emoji as flags
 *  (it shows the bare letter pair instead). Unknown locales fall back to
 *  the upper-cased code so the selector keeps working as locales grow. */
function FlagIcon({ code }: { code: string }) {
  if (code === "fr") {
    return (
      <svg
        viewBox="0 0 3 2"
        className="menubar-flag"
        aria-hidden
        focusable={false}
      >
        <rect width={3} height={2} fill="#fff" />
        <rect width={1} height={2} fill="#0055a4" />
        <rect x={2} width={1} height={2} fill="#ef4135" />
      </svg>
    );
  }
  if (code === "en") {
    return (
      <svg
        viewBox="0 0 60 30"
        className="menubar-flag"
        aria-hidden
        focusable={false}
      >
        <rect width={60} height={30} fill="#012169" />
        <path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth={6} />
        <path d="M0,0 60,30 M60,0 0,30" stroke="#c8102e" strokeWidth={4} />
        <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth={10} />
        <path d="M30,0 V30 M0,15 H60" stroke="#c8102e" strokeWidth={6} />
      </svg>
    );
  }
  return <span className="menubar-flag-code">{code.toUpperCase()}</span>;
}

/** Compact flag-based language selector. Shows only the active locale's
 *  flag to save space; clicking opens a small menu of available locales
 *  (flag + native name). Switching triggers a full page reload (see
 *  ``locale.ts``) so the Pyodide runtime re-boots with the matching
 *  ``LANG`` and guidata/Sigima ``.mo`` catalogs take effect. */
function LanguageSelector() {
  const { locale, setLocale, availableLocales } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const activeLabel =
    availableLocales.find((l) => l.code === locale)?.label ?? locale;

  return (
    <div className="menubar-language" ref={rootRef}>
      <button
        type="button"
        className="menubar-language-button"
        onClick={() => setOpen((v) => !v)}
        title={`${t("Language")} — ${activeLabel}`}
        aria-label={t("Language")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FlagIcon code={locale} />
      </button>
      {open && (
        <div className="menubar-language-menu" role="menu">
          {availableLocales.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              className={
                "menubar-language-item" +
                (code === locale ? " menubar-language-item--active" : "")
              }
              onClick={() => {
                setOpen(false);
                if (code !== locale) setLocale(code);
              }}
            >
              <FlagIcon code={code} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
