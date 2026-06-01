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
 * This component shows a discreet, English-only hint after a delay,
 * but only when the user agent looks like Microsoft Edge. The hint is
 * unmounted as soon as the runtime finishes loading.
 *
 * Note: Chromium blocks ``<a href="edge://...">`` navigation from web
 * pages for security reasons, so the settings URL is exposed as a
 * copy-to-clipboard button rather than a real link.
 */

import { useEffect, useState } from "react";

/** Detect Microsoft Edge (Chromium). The UA token is ``Edg/`` — not
 *  ``Edge/`` which was the legacy EdgeHTML browser. */
function isMicrosoftEdge(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bEdg\//.test(navigator.userAgent);
}

const HINT_DELAY_MS = 8_000;
const EDGE_SETTINGS_URL = "edge://settings/privacy";
const MS_DOC_URL =
  "https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-browse-safer";

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
        Loading is unusually slow on Microsoft Edge?
      </div>
      <div className="plot-loading-edge-hint-body">
        Edge&apos;s <strong>Enhance your security on the web</strong> setting
        disables the WebAssembly JIT compiler on unfamiliar sites, which can
        slow down Pyodide start-up by 20-40x.{" "}
        <a href={MS_DOC_URL} target="_blank" rel="noopener noreferrer">
          Microsoft recommends adding the site as an exception
        </a>{" "}
        as the official workaround for WebAssembly-heavy applications:
        <ol>
          <li>
            Open the Edge settings page (Chromium blocks direct links to{" "}
            <code>edge://</code> URLs from web pages, so use the button below to
            copy the URL, then paste it into the address bar):
            <div className="plot-loading-edge-hint-url">
              <code>{EDGE_SETTINGS_URL}</code>
              <button
                type="button"
                onClick={copyUrl}
                className="plot-loading-edge-hint-copy"
              >
                {copied ? "Copied!" : "Copy URL"}
              </button>
            </div>
          </li>
          <li>
            Under <em>Security</em>, make sure{" "}
            <em>Enhance your security on the web</em> is turned on, then click{" "}
            <em>Manage enhanced security for sites</em>.
          </li>
          <li>
            Under <em>Never use enhanced security for these sites</em>, click{" "}
            <em>Add a site</em> and enter the URL of this application (for
            example <code>https://datalab-platform.com</code>).
          </li>
          <li>Reload this page.</li>
        </ol>
      </div>
    </div>
  );
}
