/* Core translation function for DataLab-Web.
 *
 * ``t(key, vars?)`` looks the English source string (the ``key``) up in the
 * active locale's catalog and returns its translation, falling back to the
 * key itself when no entry exists (English source language, or a not-yet
 * translated string). Placeholders of the form ``{name}`` are interpolated
 * from ``vars``.
 *
 * Usage:
 *   t("Open signal…")                       // -> "Ouvrir le signal…" (fr)
 *   t("Delete {count} objects?", { count }) // -> "Supprimer 3 objets ?"
 *
 * The function is a plain synchronous export (not a hook) so it can be used
 * both in React components and in non-React modules (action registry, menu
 * builder, runtime boot). React components should prefer the ``t`` returned
 * by {@link useTranslation} for idiomatic context usage, but it is the same
 * function.
 */
import { catalogs } from "./catalogs";
import { getActiveLocale } from "./locale";

export type TranslationVars = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function translate(key: string, vars?: TranslationVars): string {
  const catalog = catalogs[getActiveLocale()];
  let result = (catalog && catalog[key]) ?? key;
  if (vars) {
    result = result.replace(PLACEHOLDER, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  }
  return result;
}

/** Short alias mirroring the gettext ``_()`` / ``t()`` convention. */
export const t = translate;
