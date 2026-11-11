/**
 * French translations of the showcase mode, merged into the application
 * catalog when the showcase chunk loads (kept out of the initial bundle).
 * Maintained by ``scripts/i18n-extract.mjs``: keys referenced only from
 * ``src/showcase/`` live in ``./locales/``.
 */

import { registerCatalog } from "../i18n/catalogs";
import fr from "./locales/fr.json";

registerCatalog("fr", fr);
