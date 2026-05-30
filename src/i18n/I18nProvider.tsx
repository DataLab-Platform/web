/* React bindings for the DataLab-Web i18n layer.
 *
 * Because switching language triggers a full page reload (see
 * ``locale.ts``), the active locale is constant for the lifetime of a
 * render tree; the provider therefore exposes a stable value. It exists
 * mainly to give components an idiomatic ``useTranslation()`` hook and a
 * single place to read the locale list / change the language.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  getActiveLocale,
  LOCALE_LABELS,
  setActiveLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locale";
import { t, type TranslationVars } from "./translate";

interface I18nContextValue {
  /** Active locale for this page load. */
  locale: SupportedLocale;
  /** Translate an English source string, with optional ``{var}`` values. */
  t: (key: string, vars?: TranslationVars) => string;
  /** Persist a new locale and reload the app. */
  setLocale: (locale: SupportedLocale) => void;
  /** Supported locales with their native display names. */
  availableLocales: ReadonlyArray<{ code: SupportedLocale; label: string }>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Provider exposing the active locale and the translation function. Wrap
 *  the whole app so every ``useTranslation()`` consumer shares one source. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale: getActiveLocale(),
      t,
      setLocale: (locale: SupportedLocale) => setActiveLocale(locale),
      availableLocales: SUPPORTED_LOCALES.map((code) => ({
        code,
        label: LOCALE_LABELS[code],
      })),
    }),
    [],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Hook returning the translation function and locale controls. Must be
 *  used inside an ``<I18nProvider>``. */
export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) {
    throw new Error("useTranslation() must be used inside an <I18nProvider>");
  }
  return ctx;
}
