/**
 * Slow-load hint shown during Pyodide initialisation on Microsoft Edge.
 *
 * Edge's "Enhance your security on the web" feature (a.k.a. Enhanced
 * Security Mode) disables the WebAssembly JIT on unfamiliar sites,
 * which makes Pyodide start-up 20-40x slower than on Chrome / Firefox.
 * Microsoft documents this explicitly and recommends adding the site
 * as an exception (see ``microsoft-edge-security-browse-safer`` page,
 * "Important" admonition):
 *
 *   > Developers should be aware that the WebAssembly (WASM) interpreter
 *   > running in enhanced security mode might not yield the expected
 *   > level of performance. We recommend adding your site as an
 *   > exception to opt-out of enhanced security mode for site users.
 *
 * This component shows a discreet, localised hint after a delay, but
 * only when the user agent looks like Microsoft Edge. The hint is
 * unmounted as soon as the runtime finishes loading. The French strings
 * reuse Microsoft's official Edge UI vocabulary (``Améliorer votre
 * sécurité sur le web``, ``Gérer la sécurité renforcée des sites``, …)
 * from the referenced ``microsoft-edge-security-browse-safer`` page.
 *
 * Note: Chromium blocks ``<a href="edge://...">`` navigation from web
 * pages for security reasons, so the settings URL is exposed as a
 * copy-to-clipboard button rather than a real link.
 */

import { useEffect, useState } from "react";
import { t } from "../i18n/translate";
import { getActiveLocale } from "../i18n/locale";

/** Detect Microsoft Edge (Chromium). The UA token is ``Edg/`` — not
 *  ``Edge/`` which was the legacy EdgeHTML browser. */
function isMicrosoftEdge(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bEdg\//.test(navigator.userAgent);
}

const HINT_DELAY_MS = 15_000;
const EDGE_SETTINGS_URL = "edge://settings/privacy/security/secureModeSites";

/** Microsoft's documentation is localised; point French users at the
 *  ``fr-fr`` variant so the wording matches the in-app hint. */
function msDocUrl(): string {
  const lang = getActiveLocale() === "fr" ? "fr-fr" : "en-us";
  return `https://learn.microsoft.com/${lang}/deployedge/microsoft-edge-security-browse-safer`;
}

export function EdgeSlowLoadHint() {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isMicrosoftEdge()) return;
    const id = window.setTimeout(() => setShow(true), HINT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  if (!show) return null;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(EDGE_SETTINGS_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): silently ignore.
    }
  };

  return (
    <div className="plot-loading-edge-hint">
      <div className="plot-loading-edge-hint-title">
        {t("Loading is unusually slow on Microsoft Edge?")}
      </div>
      <div className="plot-loading-edge-hint-body">
        {t("Edge's")} <strong>{t("Enhance your security on the web")}</strong>{" "}
        {t(
          "setting disables the WebAssembly JIT compiler on unfamiliar sites, which can slow down Pyodide start-up by 20-40x.",
        )}{" "}
        <a href={msDocUrl()} target="_blank" rel="noopener noreferrer">
          {t("Microsoft recommends adding the site as an exception")}
        </a>{" "}
        {t("as the official workaround for WebAssembly-heavy applications:")}
        <ol>
          <li>
            {t("Open the Edge settings page (Chromium blocks direct links to")}{" "}
            <code>edge://</code>{" "}
            {t(
              "URLs from web pages, so use the button below to copy the URL, then paste it into the address bar):",
            )}
            <div className="plot-loading-edge-hint-url">
              <code>{EDGE_SETTINGS_URL}</code>
              <button
                type="button"
                onClick={copyUrl}
                className="plot-loading-edge-hint-copy"
              >
                {copied ? t("Copied!") : t("Copy URL")}
              </button>
            </div>
          </li>
          <li>
            {t("Under")} <em>{t("Security")}</em>
            {t(", make sure")} <em>{t("Enhance your security on the web")}</em>{" "}
            {t("is turned on, then click")}{" "}
            <em>{t("Manage enhanced security for sites")}</em>.
          </li>
          <li>
            {t("Under")}{" "}
            <em>{t("Never use enhanced security for these sites")}</em>
            {t(", click")} <em>{t("Add a site")}</em>{" "}
            {t("and enter the URL of this application (for example")}{" "}
            <code>https://datalab-platform.com</code>).
          </li>
          <li>{t("Reload this page.")}</li>
        </ol>
      </div>
    </div>
  );
}
