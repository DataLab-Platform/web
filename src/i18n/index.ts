/* Public entry point for the DataLab-Web i18n layer.
 *
 * Import ``t`` for non-React modules, ``useTranslation`` inside components,
 * and the ``locale`` helpers when you need the active language (e.g. to pass
 * ``LANG`` to Pyodide at boot).
 */
export { t, translate, type TranslationVars } from "./translate";
export { I18nProvider, useTranslation } from "./I18nProvider";
export {
  applyHtmlLang,
  DEFAULT_LOCALE,
  getActiveLocale,
  LOCALE_LABELS,
  pyodideLang,
  setActiveLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locale";

import { applyHtmlLang, getActiveLocale } from "./locale";

/** Resolve the active locale and reflect it on ``<html lang>`` as early as
 *  possible. Call once from ``main.tsx`` before React renders. */
export function initI18nEarly(): void {
  getActiveLocale();
  applyHtmlLang();
}
