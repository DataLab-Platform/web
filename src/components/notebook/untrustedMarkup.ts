/**
 * Sanitisation of the untrusted markup of notebooks.
 *
 * Opening a ``.ipynb`` restores its outputs and markdown cells, so their HTML
 * and SVG are untrusted. Besides active content (scripts, event handlers,
 * ``javascript:`` URLs), already removed by DOMPurify, this removes:
 *
 * - form controls, which could imitate a DataLab-Web dialog, and the
 *   attributes that show content in the top layer of the page (popovers,
 *   invoker commands), out of reach of the containment of
 *   {@link IsolatedMarkup};
 * - everything that would make the browser load a remote resource:
 *   ``src`` / ``poster`` / ``background`` attributes and non-link ``href``
 *   that are not ``data:`` URIs or ``#fragment`` references, ``srcset``, and
 *   CSS ``url()`` / ``image-set()`` / ``@import`` / ``@font-face``.
 *
 * The CSS that remains only applies inside the block, which
 * {@link IsolatedMarkup} renders in a Shadow DOM.
 */

import DOMPurify from "dompurify";
import type { Config } from "dompurify";

const FORM_CONTROLS = [
  "form",
  "input",
  "button",
  "select",
  "option",
  "optgroup",
  "textarea",
  "datalist",
];

const TOP_LAYER_ATTRS = [
  "popover",
  "popovertarget",
  "popovertargetaction",
  "command",
  "commandfor",
  "interestfor",
];

/** Attributes whose URL the browser fetches. */
const RESOURCE_ATTRS = new Set(["src", "poster", "background"]);
/** Attributes holding a URL, only followed on a click on a link element and
 *  fetched on any other element (SVG ``use``, ``image``, ``feImage``…). */
const LINK_ATTRS = new Set(["href", "xlink:href"]);
const LINK_TAGS = new Set(["a", "area"]);
/** SVG presentation attributes whose CSS value may hold a ``url()``. */
const CSS_URL_ATTRS = new Set([
  "clip-path",
  "cursor",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
]);

const LOCAL_REFERENCE = /^\s*(#|data:)/i;
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
/** CSS loading a resource: ``url()`` not referencing a ``#fragment`` of the
 *  document, string-based image functions and resource at-rules. */
const CSS_RESOURCE =
  /url\((?!\s*["']?#)|image-set\(|image\(|src\(|@import|@font-face/gi;

/**
 * Return *css* unable to load any remote resource.
 *
 * Resource functions and at-rules are renamed (``url(`` → ``blocked-url(``),
 * so the browser drops the declarations or rules using them. CSS holding an
 * escape is dropped entirely, since escapes can spell any of them
 * (``u\72l(``).
 */
export function neutralizeCss(css: string): string {
  const text = css.replace(CSS_COMMENT, "");
  if (text.includes("\\")) return "";
  return text.replace(CSS_RESOURCE, (match) =>
    match.startsWith("@") ? `@blocked-${match.slice(1)}` : `blocked-${match}`,
  );
}

const purifier = DOMPurify(window);

purifier.addHook("uponSanitizeElement", (node, event) => {
  if (event.tagName === "style") {
    node.textContent = neutralizeCss(node.textContent ?? "");
  }
});

purifier.addHook("uponSanitizeAttribute", (node, event) => {
  const name = event.attrName;
  const tag = node.nodeName.toLowerCase();
  if (
    RESOURCE_ATTRS.has(name) ||
    (LINK_ATTRS.has(name) && !LINK_TAGS.has(tag))
  ) {
    event.keepAttr = LOCAL_REFERENCE.test(event.attrValue);
  } else if (name === "style") {
    event.attrValue = neutralizeCss(event.attrValue);
  } else if (CSS_URL_ATTRS.has(name)) {
    event.keepAttr = neutralizeCss(event.attrValue) === event.attrValue;
  }
});

const COMMON_CONFIG: Config = {
  FORBID_TAGS: FORM_CONTROLS,
  FORBID_ATTR: ["srcset", ...TOP_LAYER_ATTRS],
};

/** Sanitise untrusted HTML. ``FORCE_BODY`` keeps a leading ``<style>`` block
 *  (e.g. that of Sigima's ``_repr_html_`` tables), which the HTML parser
 *  would otherwise drop. */
export function sanitizeUntrustedHtml(html: string): string {
  return purifier.sanitize(html, {
    ...COMMON_CONFIG,
    USE_PROFILES: { html: true },
    FORCE_BODY: true,
  });
}

/** Sanitise an untrusted SVG document. */
export function sanitizeUntrustedSvg(svg: string): string {
  return purifier.sanitize(svg, {
    ...COMMON_CONFIG,
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
