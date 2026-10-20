/**
 * Locale-dependent strings the Python runtime needs.
 *
 * ``bootstrap.py`` is DataLab-Web's own code: its few user-facing strings
 * (default labels, its own dialogs such as "Add metadata") are translated by
 * the UI catalogs (``src/locales``), not by gettext like Sigima and guidata.
 * They are computed where the active locale is known — the main thread; a
 * DOM-less worker cannot detect it — and pushed in when the runtime boots.
 */
import { catalogs } from "../i18n/catalogs";
import { getActiveLocale } from "../i18n/locale";
import { t } from "../i18n/translate";

export interface RuntimeLabels {
  /** Default group-name prefix. */
  group: string;
  /** Default macro / notebook title. */
  untitled: string;
  /** English source string -> translation in the active locale (empty in
   *  English), used by ``_web()`` in ``bootstrap.py``. */
  translations: Record<string, string>;
}

/** Return the runtime labels of the active UI locale. */
export function currentRuntimeLabels(): RuntimeLabels {
  return {
    group: t("Group"),
    untitled: t("Untitled"),
    translations: { ...(catalogs[getActiveLocale()] ?? {}) },
  };
}
