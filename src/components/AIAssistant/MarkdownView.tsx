/**
 * Markdown renderer for assistant messages.
 *
 * Uses :mod:`marked` for parsing and :mod:`DOMPurify` to sanitize the
 * resulting HTML — assistant output is untrusted and may contain
 * arbitrary text the model decided to echo back from the workspace.
 *
 * In addition to the standard HTML sanitization, we strip *inline
 * images* from the rendered output. Small local LLMs (Qwen, Gemma,
 * Llama 3.2 at low quant) sometimes hallucinate Markdown image tags
 * with fabricated ``data:image/...;base64`` URIs after a tool that
 * actually returned an image — cluttering the chat with a broken
 * picture. Real screenshots flow through dedicated UI components, not
 * through inline Markdown, so suppressing ``<img>`` here is safe.
 */

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { t } from "../../i18n/translate";
import { marked } from "marked";

interface Props {
  text: string;
}

/** Replace ``![alt](data:image/...)`` and very-long base64 data URIs
 *  in the *source* Markdown with a short placeholder. Done before
 *  parsing so the resulting HTML doesn't even contain the blob. */
function stripInlineImages(text: string): string {
  // Markdown image with data: URI (any subtype, any length).
  let out = text.replace(
    /!\[[^\]]*\]\(\s*data:[^)]*\)/gi,
    t("_[image omitted]_"),
  );
  // Markdown image with any other URL — also unwanted (the model
  // shouldn't be linking to remote images either).
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, t("_[image omitted: $1]_"));
  // Raw ``data:image/...;base64,XXXX`` URI sitting bare in prose
  // (truncated streaming responses sometimes leave one dangling).
  out = out.replace(
    /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{40,}/gi,
    t("[base64 image omitted]"),
  );
  return out;
}

export function MarkdownView({ text }: Props) {
  const html = useMemo(() => {
    const cleaned = stripInlineImages(text);
    const raw = marked.parse(cleaned, { async: false }) as string;
    // Defence in depth: even if a future ``marked`` plugin lets an
    // ``<img>`` through, DOMPurify drops it entirely.
    return DOMPurify.sanitize(raw, { FORBID_TAGS: ["img"] });
  }, [text]);
  return (
    <div className="ai-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
