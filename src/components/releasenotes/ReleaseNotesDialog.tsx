/**
 * ReleaseNotesDialog — modal rendering the bundled ``CHANGELOG.md``.
 *
 * The changelog is imported through Vite's ``?raw`` query so it ships
 * with the application bundle and always matches the running version.
 * Markdown is rendered with the shared :mod:`MarkdownView` (``marked``
 * + ``DOMPurify``).
 *
 * Opening the dialog records the current version as "seen" via
 * :func:`markReleaseSeen`, which clears the "NEW" badge surfaced by
 * the Welcome page.
 */

import { useEffect } from "react";
import { MarkdownView } from "../AIAssistant/MarkdownView";
import { markReleaseSeen } from "../../utils/releaseNotes";
import changelogMd from "../../../CHANGELOG.md?raw";

/**
 * Drop the ``## [Unreleased]`` heading when it has no entries.
 *
 * The release script keeps an empty ``[Unreleased]`` section on top of
 * the changelog so future pull requests have a place to land. In a
 * shipped build that section is empty, and rendering its bare heading
 * in the in-app dialog would show a dangling "Unreleased" title with no
 * content. We strip the heading (and its reference-style link, if any)
 * only when the section body is empty, leaving a populated
 * ``[Unreleased]`` untouched for local/dev builds.
 */
function stripEmptyUnreleased(md: string): string {
  const header = "## [Unreleased]";
  const start = md.indexOf(header);
  if (start === -1) return md;
  const next = md.indexOf("\n## [", start + header.length);
  if (next === -1) return md;
  const body = md.slice(start + header.length, next).trim();
  if (body) return md;
  let stripped = md.slice(0, start) + md.slice(next + 1);
  // Remove the now-orphaned bottom link reference, if present.
  stripped = stripped.replace(/^\[Unreleased\]:.*\n?/m, "");
  return stripped;
}

const releaseNotesMd = stripEmptyUnreleased(changelogMd);

interface Props {
  /** Current application version (e.g. ``"0.2.0"``). */
  appVersion: string;
  onClose: () => void;
}

export function ReleaseNotesDialog({ appVersion, onClose }: Props) {
  // Esc closes the dialog (mirrors HelpDialog).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Mark this version as seen as soon as the dialog is mounted.
  useEffect(() => {
    markReleaseSeen(appVersion);
  }, [appVersion]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-dialog-title"
      onClick={onClose}
    >
      <div
        className="card help-dialog release-notes-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="release-notes-dialog-title">Release notes</h2>
        <div className="help-dialog-body release-notes-body">
          <MarkdownView text={releaseNotesMd} />
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
