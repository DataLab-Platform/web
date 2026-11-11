/**
 * UserGuidePanel — in-app drawer rendering bundled Markdown documentation.
 *
 * The drawer is anchored to the right side of the workspace (same pattern
 * as :mod:`AIAssistantPanel`). Pages are loaded statically via Vite's
 * ``?raw`` query so the documentation is bundled with the application and
 * always matches the running version. Markdown is rendered with the
 * shared :mod:`MarkdownView` (``marked`` + ``DOMPurify``).
 *
 * Links to bundled pages are resolved relative to each Markdown source
 * and intercepted to switch the active page without leaving the drawer;
 * external links open in a new tab.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MarkdownView } from "../AIAssistant/MarkdownView";
import { t } from "../../i18n/translate";
import welcomeMd from "../../../doc/userguide/welcome.md?raw";
import differencesMd from "../../../doc/userguide/differences-from-desktop.md?raw";
import engineMd from "../../../doc/userguide/computation-engine.md?raw";
import provenanceMd from "../../../doc/userguide/provenance-and-capsules.md?raw";
import showcaseMd from "../../../doc/userguide/showcase-mode.md?raw";
import notebooksMd from "../../../doc/notebooks.md?raw";
import pluginsMd from "../../../doc/plugins.md?raw";

interface GuidePage {
  slug: string;
  title: string;
  sourcePath: string;
  source: string;
}

const PAGES: GuidePage[] = [
  {
    slug: "welcome",
    title: "Welcome",
    sourcePath: "doc/userguide/welcome.md",
    source: welcomeMd,
  },
  {
    slug: "differences-from-desktop",
    title: "Differences from desktop",
    sourcePath: "doc/userguide/differences-from-desktop.md",
    source: differencesMd,
  },
  {
    slug: "computation-engine",
    title: "Computation engine (Sigima)",
    sourcePath: "doc/userguide/computation-engine.md",
    source: engineMd,
  },
  {
    slug: "provenance-and-capsules",
    title: "Provenance and capsules",
    sourcePath: "doc/userguide/provenance-and-capsules.md",
    source: provenanceMd,
  },
  {
    slug: "notebooks",
    title: "Notebooks",
    sourcePath: "doc/notebooks.md",
    source: notebooksMd,
  },
  {
    slug: "plugins",
    title: "Plugins",
    sourcePath: "doc/plugins.md",
    source: pluginsMd,
  },
  {
    slug: "showcase-mode",
    title: "Showcase mode",
    sourcePath: "doc/userguide/showcase-mode.md",
    source: showcaseMd,
  },
];

const GUIDE_SOURCE_ROOT = "https://userguide.invalid/";
const PAGE_BY_URL = new Map(
  PAGES.map((page) => [
    new URL(page.sourcePath, GUIDE_SOURCE_ROOT).href,
    page.slug,
  ]),
);

function pageForLink(href: string, sourcePath: string): string | undefined {
  const reference = href.trim().replace(/[\t\r\n]/g, "");
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|[\\/#?])/i.test(reference)) {
    return undefined;
  }
  const base = new URL(sourcePath, GUIDE_SOURCE_ROOT);
  return PAGE_BY_URL.get(new URL(reference, base).href);
}

interface Props {
  onClose: () => void;
}

export function UserGuidePanel({ onClose }: Props) {
  // The drawer always opens on the Welcome page. Page selection is *not*
  // persisted across drawer open/close cycles (nor across full page
  // reloads): closing and reopening the user guide is meant to be a fresh
  // start, which matches the in-memory ``scrollPositions`` lifetime.
  const [activeSlug, setActiveSlug] = useState<string>("welcome");

  const activePage = useMemo(
    () => PAGES.find((p) => p.slug === activeSlug) ?? PAGES[0],
    [activeSlug],
  );

  // Per-page scroll positions, kept for the lifetime of the drawer
  // (component instance). The scroll position of the page being left is
  // captured *before* the content is swapped (in ``goToPage``); the
  // position of the page being entered is restored after the swap (in a
  // layout effect). This ordering avoids reading ``scrollTop`` on a
  // container whose content has just been replaced — at that point the
  // browser may have clamped the value to the new ``scrollHeight``.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const goToPage = useCallback(
    (slug: string) => {
      if (slug === activeSlug) return;
      const node = contentRef.current;
      if (node) {
        scrollPositions.current.set(activeSlug, node.scrollTop);
      }
      setActiveSlug(slug);
    },
    [activeSlug],
  );

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const target = scrollPositions.current.get(activeSlug) ?? 0;
    node.scrollTop = target;
    // Re-apply on the next frame in case images or other late layout
    // affect the effective scroll height after this synchronous pass.
    const raf = requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSlug]);

  // Only intercept links resolving to a bundled source file. Anchors,
  // external URLs and other files keep their normal browser behaviour.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const internal = pageForLink(href, activePage.sourcePath);
      if (internal) {
        event.preventDefault();
        goToPage(internal);
        return;
      }
      // Make outbound links open in a new tab even if the source markdown
      // didn't specify it.
      if (/^https?:/i.test(href) && !anchor.target) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
    },
    [activePage.sourcePath, goToPage],
  );

  return (
    <aside
      className="userguide-panel panel"
      data-testid="userguide-panel"
      role="complementary"
      aria-label={t("User guide")}
    >
      <div className="panel-header userguide-header">
        <span style={{ flex: 1 }}>{t("User guide")}</span>
        <button
          type="button"
          className="userguide-button"
          onClick={onClose}
          title={t("Close user guide")}
          aria-label={t("Close user guide")}
        >
          ×
        </button>
      </div>
      <div className="userguide-body">
        <nav
          className="userguide-toc"
          aria-label={t("User guide table of contents")}
        >
          <ul>
            {PAGES.map((page) => (
              <li key={page.slug}>
                <button
                  type="button"
                  className={
                    page.slug === activeSlug
                      ? "userguide-toc-item active"
                      : "userguide-toc-item"
                  }
                  onClick={() => goToPage(page.slug)}
                >
                  {t(page.title)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div
          className="userguide-content"
          onClick={handleClick}
          data-testid="userguide-content"
          ref={contentRef}
        >
          <MarkdownView text={activePage.source} />
        </div>
      </div>
    </aside>
  );
}
