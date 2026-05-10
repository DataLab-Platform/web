/**
 * Markdown renderer for assistant messages.
 *
 * Uses :mod:`marked` for parsing and :mod:`DOMPurify` to sanitize the
 * resulting HTML — assistant output is untrusted and may contain
 * arbitrary text the model decided to echo back from the workspace.
 */

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

interface Props {
  text: string;
}

export function MarkdownView({ text }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [text]);
  return (
    <div className="ai-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
