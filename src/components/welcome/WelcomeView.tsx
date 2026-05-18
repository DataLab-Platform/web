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

import { useCallback } from "react";

import { getRootIconUrl } from "../../assets/rootIcons";
import { getIoIconUrl } from "../../assets/ioIcons";
import { getHelpIconUrl } from "../../assets/helpIcons";
import { getH5IconUrl } from "../../assets/h5Icons";

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
  onCreateKind: (kind: "signal" | "image") => void;
  /** Switch to ``kind`` panel and open the file picker (kind-aware). */
  onOpenFileKind: (kind: "signal" | "image") => void;
  /** Open the HDF5 browser dialog (flagship feature). */
  onBrowseHdf5: () => void;
  onOpenWorkspaceHdf5: () => void;
  onImportTextWizard: () => void;
  onStartTour: () => void;
  onOpenUserGuide: () => void;
}

interface KindChip {
  kind: "signal" | "image";
  label: string;
  iconUrl: string | undefined;
  onClick: () => void;
}

interface QuickAction {
  iconUrl: string | undefined;
  label: string;
  description?: string;
  onClick?: () => void;
  chips?: KindChip[];
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
}: WelcomeViewProps) {
  const signalChip: KindChip = {
    kind: "signal",
    label: "Signal",
    iconUrl: getRootIconUrl("signal.svg"),
    onClick: () => {},
  };
  const imageChip: KindChip = {
    kind: "image",
    label: "Image",
    iconUrl: getRootIconUrl("image.svg"),
    onClick: () => {},
  };

  const startActions: QuickAction[] = [
    {
      iconUrl: getRootIconUrl("signal.svg"),
      label: "Create…",
      description: "Generate a 1D signal or 2D image from a Sigima template.",
      chips: [
        { ...signalChip, onClick: () => onCreateKind("signal") },
        { ...imageChip, onClick: () => onCreateKind("image") },
      ],
    },
    {
      iconUrl: getIoIconUrl("fileopen_sig.svg"),
      label: "Open file…",
      description: "Load a signal or image from your computer.",
      chips: [
        { ...signalChip, onClick: () => onOpenFileKind("signal") },
        { ...imageChip, onClick: () => onOpenFileKind("image") },
      ],
    },
    {
      iconUrl: getH5IconUrl("h5browser.svg"),
      label: "Browse HDF5 file…",
      description:
        "Inspect any HDF5 file and import selected datasets as signals or images.",
      onClick: onBrowseHdf5,
    },
    {
      iconUrl: getIoIconUrl("fileopen_h5.svg"),
      label: "Open HDF5 workspace…",
      description: "Resume a previously saved DataLab workspace.",
      onClick: onOpenWorkspaceHdf5,
    },
    {
      iconUrl: getIoIconUrl("import_text.svg"),
      label: "Import text data…",
      description: "Bring in CSV / TSV / column data with the wizard.",
      onClick: onImportTextWizard,
    },
  ];

  const walkthroughActions: QuickAction[] = [
    {
      iconUrl: getRootIconUrl("visualization.svg"),
      label: "Take the guided tour",
      description:
        "A short interactive walk-through of the DataLab-Web workspace.",
      onClick: onStartTour,
    },
    {
      iconUrl: getHelpIconUrl("libre-gui-help.svg"),
      label: "Read the user guide",
      description:
        "Open the in-app documentation covering the browser-native specifics.",
      onClick: onOpenUserGuide,
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
            src={new URL("../../assets/DataLab-Banner2.svg", import.meta.url).href}
            alt="DataLab"
            className="welcome-logo"
          />
          <div className="welcome-title-block">
            <div className="welcome-subtitle">
              Browser-native scientific data processing — version {appVersion}
            </div>
          </div>
          {onDismiss && (
            <button
              type="button"
              className="welcome-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss welcome page"
              title="Dismiss"
            >
              ×
            </button>
          )}
        </header>

        <div className="welcome-columns">
          <section className="welcome-column">
            <h2 className="welcome-column-title">
              {workspaceEmpty ? "Get started" : "Quick actions"}
            </h2>
            <ul className="welcome-action-list">
              {startActions.map((a) => (
                <WelcomeActionRow key={a.label} action={a} />
              ))}
            </ul>
          </section>

          <section className="welcome-column">
            <h2 className="welcome-column-title">Walkthroughs</h2>
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
            Show welcome page on startup
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
    variant === "card" ? "welcome-action welcome-action-card" : "welcome-action";
  const hasChips = action.chips && action.chips.length > 0;
  const content = (
    <>
      {action.iconUrl && (
        <img
          src={action.iconUrl}
          alt=""
          aria-hidden="true"
          className="welcome-action-icon"
        />
      )}
      <span className="welcome-action-text">
        <span className="welcome-action-label">{action.label}</span>
        {action.description && (
          <span className="welcome-action-description">
            {action.description}
          </span>
        )}
      </span>
      {hasChips && (
        <span className="welcome-action-chips">
          {action.chips!.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              className="welcome-action-chip"
              onClick={(e) => {
                e.stopPropagation();
                chip.onClick();
              }}
              title={`${action.label.replace(/…$/, "")} ${chip.label}`}
            >
              {chip.iconUrl && (
                <img
                  src={chip.iconUrl}
                  alt=""
                  aria-hidden="true"
                  className="welcome-action-chip-icon"
                />
              )}
              <span>{chip.label}</span>
            </button>
          ))}
        </span>
      )}
    </>
  );
  if (hasChips) {
    // No outer button — chips are the interactive elements.
    return (
      <li>
        <div className={className + " welcome-action-static"}>{content}</div>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className={className} onClick={action.onClick}>
        {content}
      </button>
    </li>
  );
}
