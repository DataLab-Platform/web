/**
 * WelcomeView — VS Code-style "Welcome" page shown in the central area
 * when the workspace is empty or when the user explicitly re-opens it
 * from the Help menu.
 *
 * Mirrors the spirit of the desktop DataLab guided tour
 * (``datalab/gui/tour.py``) by surfacing common startup actions and a
 * launcher for the in-app guided tour.  All actions are dispatched
 * through callbacks supplied by ``App.tsx`` — the component holds no
 * business logic.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { getRootIconUrl } from "../../assets/rootIcons";
import { getIoIconUrl } from "../../assets/ioIcons";
import { getHelpIconUrl } from "../../assets/helpIcons";
import { getH5IconUrl } from "../../assets/h5Icons";
import { useUnseenRelease } from "../../utils/releaseNotes";
import { t } from "../../i18n/translate";

type Kind = "signal" | "image";

const KIND_LABEL: Record<Kind, string> = {
  signal: "Signal",
  image: "Image",
};

const KIND_ICON: Record<Kind, string> = {
  signal: "signal.svg",
  image: "image.svg",
};

const SHOW_ON_STARTUP_KEY = "datalab-web.welcome.showOnStartup";

export interface WelcomeViewProps {
  appVersion: string;
  /** ``true`` when the workspace is empty.  Drives the wording of the
   *  primary call-to-action ("Get started" vs "Quick actions"). */
  workspaceEmpty: boolean;
  /** Optional dismiss button — only shown when the user opened the
   *  Welcome view explicitly on a non-empty workspace. */
  onDismiss?: () => void;
  /** Switch to ``kind`` panel and open the Create menu. */
  onCreateKind: (kind: Kind) => void;
  /** Switch to ``kind`` panel and open the file picker (kind-aware). */
  onOpenFileKind: (kind: Kind) => void;
  /** Open the HDF5 browser dialog (flagship feature). */
  onBrowseHdf5: () => void;
  onOpenWorkspaceHdf5: () => void;
  onImportTextWizard: () => void;
  onStartTour: () => void;
  onOpenUserGuide: () => void;
  onOpenReleaseNotes: () => void;
}

interface QuickAction {
  iconUrl: string | undefined;
  label: string;
  description?: string;
  onClick?: () => void;
  /** When set, clicking the row opens a small popover letting the user
   *  choose between Signal and Image. ``onKindSelect`` receives the
   *  picked kind. */
  onKindSelect?: (kind: Kind) => void;
  /** Optional short text rendered as a coloured pill at the end of the
   *  row label (e.g. ``"NEW"`` to highlight the release notes entry on
   *  the first launch after an upgrade). */
  badge?: string;
}

/** Read/write helper for the "show welcome on startup" preference. */
export function readShowWelcomeOnStartup(): boolean {
  try {
    const raw = window.localStorage.getItem(SHOW_ON_STARTUP_KEY);
    // Default ``true``: a fresh install always shows the Welcome page.
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function writeShowWelcomeOnStartup(value: boolean): void {
  try {
    window.localStorage.setItem(SHOW_ON_STARTUP_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota / privacy mode errors */
  }
}

export function WelcomeView({
  appVersion,
  workspaceEmpty,
  onDismiss,
  onCreateKind,
  onOpenFileKind,
  onBrowseHdf5,
  onOpenWorkspaceHdf5,
  onImportTextWizard,
  onStartTour,
  onOpenUserGuide,
  onOpenReleaseNotes,
}: WelcomeViewProps) {
  const releaseNotesUnseen = useUnseenRelease(appVersion);
  const startActions: QuickAction[] = [
    {
      iconUrl: getRootIconUrl("signal.svg"),
      label: t("Create…"),
      description: t(
        "Generate a 1D signal or 2D image from a Sigima template.",
      ),
      onKindSelect: onCreateKind,
    },
    {
      iconUrl: getIoIconUrl("fileopen_sig.svg"),
      label: t("Open file…"),
      description: t("Load a signal or image from your computer."),
      onKindSelect: onOpenFileKind,
    },
    {
      iconUrl: getH5IconUrl("h5browser.svg"),
      label: t("Browse HDF5 file…"),
      description: t(
        "Inspect any HDF5 file and import selected datasets as signals or images.",
      ),
      onClick: onBrowseHdf5,
    },
    {
      iconUrl: getIoIconUrl("fileopen_h5.svg"),
      label: t("Open HDF5 workspace…"),
      description: t("Resume a previously saved DataLab workspace."),
      onClick: onOpenWorkspaceHdf5,
    },
    {
      iconUrl: getIoIconUrl("import_text.svg"),
      label: t("Import text data…"),
      description: t("Bring in CSV / TSV / column data with the wizard."),
      onClick: onImportTextWizard,
    },
  ];

  const walkthroughActions: QuickAction[] = [
    {
      iconUrl: getRootIconUrl("visualization.svg"),
      label: t("Take the guided tour"),
      description: t(
        "A short interactive walk-through of the DataLab-Web workspace.",
      ),
      onClick: onStartTour,
    },
    {
      iconUrl: getHelpIconUrl("libre-gui-help.svg"),
      label: t("Read the user guide"),
      description: t(
        "Open the in-app documentation covering the browser-native specifics.",
      ),
      onClick: onOpenUserGuide,
    },
    {
      iconUrl: getHelpIconUrl("libre-gui-about.svg"),
      label: t("What’s new in v{version}", { version: appVersion }),
      description: t(
        "Browse the full release notes and recent changes to DataLab-Web.",
      ),
      onClick: onOpenReleaseNotes,
      badge: releaseNotesUnseen ? "NEW" : undefined,
    },
  ];

  const handleShowOnStartupToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      writeShowWelcomeOnStartup(e.target.checked);
    },
    [],
  );

  return (
    <div className="welcome-view" data-tour="welcome-view">
      <div className="welcome-view-inner">
        <header className="welcome-header">
          <img
            src={
              new URL("../../assets/DataLab-Banner2.svg", import.meta.url).href
            }
            alt="DataLab"
            className="welcome-logo"
          />
          <div className="welcome-title-block">
            <div className="welcome-subtitle">
              {t(
                "Browser-native scientific data processing — version {version}",
                { version: appVersion },
              )}
            </div>
          </div>
          {onDismiss && (
            <button
              type="button"
              className="welcome-dismiss"
              onClick={onDismiss}
              aria-label={t("Dismiss welcome page")}
              title={t("Dismiss")}
            >
              ×
            </button>
          )}
        </header>

        <div className="welcome-columns">
          <section className="welcome-column">
            <h2 className="welcome-column-title">
              {workspaceEmpty ? t("Get started") : t("Quick actions")}
            </h2>
            <ul className="welcome-action-list">
              {startActions.map((a) => (
                <WelcomeActionRow key={a.label} action={a} />
              ))}
            </ul>
          </section>

          <section className="welcome-column">
            <h2 className="welcome-column-title">{t("Walkthroughs")}</h2>
            <ul className="welcome-action-list">
              {walkthroughActions.map((a) => (
                <WelcomeActionRow key={a.label} action={a} variant="card" />
              ))}
            </ul>
          </section>
        </div>

        <footer className="welcome-footer">
          <label className="welcome-startup-toggle">
            <input
              type="checkbox"
              defaultChecked={readShowWelcomeOnStartup()}
              onChange={handleShowOnStartupToggle}
            />
            {t("Show welcome page on startup")}
          </label>
        </footer>
      </div>
    </div>
  );
}

function WelcomeActionRow({
  action,
  variant,
}: {
  action: QuickAction;
  variant?: "row" | "card";
}) {
  const className =
    variant === "card"
      ? "welcome-action welcome-action-card"
      : "welcome-action";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasKindPicker = !!action.onKindSelect;
  const handleClick = useCallback(() => {
    if (hasKindPicker) {
      setPickerOpen((open) => !open);
    } else {
      action.onClick?.();
    }
  }, [action, hasKindPicker]);
  const handleKindPick = useCallback(
    (kind: Kind) => {
      setPickerOpen(false);
      action.onKindSelect?.(kind);
    },
    [action],
  );
  return (
    <li>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        onClick={handleClick}
        aria-haspopup={hasKindPicker ? "menu" : undefined}
        aria-expanded={hasKindPicker ? pickerOpen : undefined}
      >
        {action.iconUrl && (
          <img
            src={action.iconUrl}
            alt=""
            aria-hidden="true"
            className="welcome-action-icon"
          />
        )}
        <span className="welcome-action-text">
          <span className="welcome-action-label">
            {action.label}
            {action.badge && (
              <span className="welcome-action-badge" aria-label={t("New")}>
                {action.badge}
              </span>
            )}
          </span>
          {action.description && (
            <span className="welcome-action-description">
              {action.description}
            </span>
          )}
        </span>
        {hasKindPicker && (
          <span className="welcome-action-caret" aria-hidden="true">
            ▾
          </span>
        )}
      </button>
      {hasKindPicker && pickerOpen && (
        <WelcomeKindPicker
          anchorRef={buttonRef}
          actionLabel={action.label}
          onPick={handleKindPick}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </li>
  );
}

/**
 * Small floating popover anchored under a Welcome action row, letting
 * the user pick between **Signal** and **Image** for kind-aware actions
 * (Create…, Open file…).
 *
 * Closes on outside click, ``Escape``, scroll or window resize — same
 * dismissal contract as the app's :class:`ContextMenu`.
 */
function WelcomeKindPicker({
  anchorRef,
  actionLabel,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  actionLabel: string;
  onPick: (kind: Kind) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  // Anchor under the row's lower-left corner and match its width so the
  // popover spans the same clickable area as the row. Clamp inside the
  // viewport after the popover has been laid out.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [anchorRef]);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el || !pos) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    let { top, left } = pos;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      if (anchorRect) {
        top = Math.max(margin, anchorRect.top - rect.height - 4);
      } else {
        top = Math.max(margin, window.innerHeight - rect.height - margin);
      }
    }
    if (top !== pos.top || left !== pos.left) {
      setPos({ top, left, width: pos.width });
    }
  }, [pos, anchorRef]);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleScrollOrResize = () => onClose();
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [anchorRef, onClose]);

  const cleanLabel = actionLabel.replace(/…$/, "");
  const kinds: Kind[] = ["signal", "image"];
  return (
    <div
      ref={popoverRef}
      className="welcome-kind-picker"
      role="menu"
      aria-label={cleanLabel}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width,
        visibility: pos ? "visible" : "hidden",
        zIndex: 1000,
      }}
    >
      {kinds.map((kind, idx) => (
        <button
          key={kind}
          ref={idx === 0 ? firstItemRef : undefined}
          type="button"
          className="welcome-kind-picker-item"
          role="menuitem"
          onClick={() => onPick(kind)}
          title={`${cleanLabel} ${t(KIND_LABEL[kind])}`}
        >
          <img
            src={getRootIconUrl(KIND_ICON[kind])}
            alt=""
            aria-hidden="true"
            className="welcome-kind-picker-icon"
          />
          <span>{t(KIND_LABEL[kind])}</span>
        </button>
      ))}
    </div>
  );
}
