/* Locale detection and persistence for DataLab-Web.
 *
 * The active locale is resolved **once** per page load and cached, because
 * switching language requires a full page reload anyway (the Pyodide
 * instance pins ``LANG`` at boot and Sigima/guidata cache their gettext
 * labels at import time — see ``runtime.ts`` and the "Internationalisation"
 * section of ``README.md``).
 *
 * Resolution order (first match wins):
 *   1. ``?lang=<code>`` URL query parameter (handy for sharing links / E2E)
 *   2. ``localStorage["datalab-web:lang"]`` (explicit user choice)
 *   3. ``navigator.languages`` / ``navigator.language`` (regional preference)
 *   4. {@link DEFAULT_LOCALE} (English source language)
 *
 * This module is intentionally framework-agnostic (no React) so that both
 * the React UI (via ``useTranslation``) and non-React code (the action
 * registry, the Pyodide boot in ``runtime.ts``) can read the active locale.
 */

/** Locales shipped with DataLab-Web. English is the source language. */
export const SUPPORTED_LOCALES = ["en", "fr"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Fallback locale = source language (untranslated ``msgid`` strings). */
export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Native display name for each locale, used by the language selector. */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  fr: "Français",
};

const STORAGE_KEY = "datalab-web:lang";

function isSupported(code: string): code is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/** Normalise a raw BCP-47 / POSIX tag (``fr-FR``, ``fr_FR.UTF-8``) to a
 *  supported base locale (``fr``), or ``null`` when unsupported. */
function normalize(raw: string | null | undefined): SupportedLocale | null {
  if (!raw) return null;
  const base = raw.toLowerCase().split(/[-_.]/)[0];
  return isSupported(base) ? base : null;
}

function detect(): SupportedLocale {
  // 1. ``?lang=`` URL parameter.
  try {
    const param = new URLSearchParams(window.location.search).get("lang");
    const fromUrl = normalize(param);
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore — URL may be unavailable in some environments */
  }
  // 2. Persisted explicit choice.
  try {
    const stored = normalize(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore — localStorage may be unavailable */
  }
  // 3. Browser regional preferences (ordered list).
  try {
    const langs =
      navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
    for (const lang of langs) {
      const n = normalize(lang);
      if (n) return n;
    }
  } catch {
    /* ignore — navigator may be unavailable */
  }
  return DEFAULT_LOCALE;
}

let active: SupportedLocale | null = null;

/** Return the active locale for this page load (memoised). */
export function getActiveLocale(): SupportedLocale {
  if (active === null) {
    active = detect();
  }
  return active;
}

/** Map a locale to the ``LANG`` value Pyodide should boot with so that
 *  Sigima/guidata gettext labels match the UI. English maps to the POSIX
 *  ``C`` locale (gettext returns the untranslated English ``msgid``); other
 *  locales map to their bare code (e.g. ``fr``), which gettext expands to
 *  load ``locale/<code>/LC_MESSAGES/*.mo`` from the installed wheels. */
export function pyodideLang(
  locale: SupportedLocale = getActiveLocale(),
): string {
  return locale === "en" ? "C" : locale;
}

/** Reflect the active locale on ``<html lang>`` for accessibility / SEO. */
export function applyHtmlLang(): void {
  try {
    document.documentElement.setAttribute("lang", getActiveLocale());
  } catch {
    /* ignore — no document (e.g. worker context) */
  }
}

/** Persist a new locale and reload so a fresh Pyodide instance boots with
 *  the matching ``LANG``. Pass ``{ reload: false }`` to only persist (tests).
 */
export function setActiveLocale(
  locale: SupportedLocale,
  opts: { reload?: boolean } = {},
): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore — localStorage may be unavailable */
  }
  active = locale;
  if (opts.reload === false) return;
  try {
    // Drop any ``?lang=`` override so the persisted choice wins after reload.
    const url = new URL(window.location.href);
    url.searchParams.delete("lang");
    window.location.replace(url.toString());
  } catch {
    /* ignore — navigation may be unavailable */
  }
}
