/* Translation catalogs for DataLab-Web.
 *
 * English is the source language: ``msgid`` strings are the English text
 * written directly in the code, so no ``en`` catalog is needed (a missing
 * entry falls back to the key itself — see ``translate.ts``).
 *
 * Non-English catalogs are plain ``{ "<English source>": "<translation>" }``
 * JSON maps, statically imported so that ``t()`` stays fully synchronous and
 * usable from non-React code (the action registry, menu builder, …). With a
 * handful of locales the bundling cost is negligible; switch to dynamic
 * ``import()`` only if the catalog count grows significantly.
 *
 * A lazily loaded feature may ship its own catalog (e.g. the captions of the
 * showcase mode, ``src/showcase/locales/``) and merge it with
 * :func:`registerCatalog` when its chunk loads, so that its texts stay out of
 * the initial bundle. ``scripts/i18n-extract.mjs`` routes each key to the
 * right catalog.
 */
import fr from "../locales/fr.json";
import type { SupportedLocale } from "./locale";

export type Catalog = Record<string, string>;

export const catalogs: Partial<Record<SupportedLocale, Catalog>> = {
  fr: fr as Catalog,
};

/** Merge the *entries* of a lazily loaded catalog into *locale*'s catalog. */
export function registerCatalog(
  locale: SupportedLocale,
  entries: Catalog,
): void {
  catalogs[locale] = { ...catalogs[locale], ...entries };
}
