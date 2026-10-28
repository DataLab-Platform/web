import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * Object references stay readable in the object tree, in every row state.
 *
 * Each row shows its own short id (``#daac2d2e · 500 pts``) and its title
 * may hold links to source objects or groups (:class:`TitleWithLinks`).
 * These were hard to read on selected rows: on the current row the links
 * took the title color, and the hovered links vanished behind the global
 * ``button:hover`` background.
 *
 * The real ``src/styles.css`` is applied to static markup mirroring the
 * classes rendered by :class:`ObjectTree`, so the browser resolves the
 * actual cascade (theme variables, ``rgba`` layers, hover rules) without
 * booting Pyodide. Keep the markup in sync with ``ObjectTree.tsx``.
 */

const STYLES = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
    "styles.css",
  ),
  "utf8",
);

/** WCAG AA threshold for normal-size text. */
const MIN_CONTRAST = 4.5;

const link = (token: string) =>
  `<button type="button" class="title-oid-link">${token}</button>`;

const GROUP_CASES = ["", "selected"];
const ROW_CASES = ["", "selected", "current", "selected current"];

const MARKUP = `
<div id="root"><div class="app"><div class="workspace">
<aside class="panel" style="width: 320px"><div class="panel-body">
<div class="object-tree"><div class="object-tree-group">
${GROUP_CASES.map(
  (cls) => `
  <div class="object-tree-group-header ${cls}" data-case="group ${cls || "normal"}">
    <button type="button" class="object-tree-toggle">▾</button>
    <span class="object-tree-group-name"><span>fft(${link("gb64708b1")})</span></span>
    <span class="object-tree-count">2</span>
  </div>`,
).join("")}
  <ul class="object-tree-list">
  ${ROW_CASES.map(
    (cls) => `
    <li class="object-tree-item ${cls}" data-case="row ${cls || "normal"}">
      <span class="object-tree-title">add_gaussian_noise(${link("b64708b1")})|μ=0.1</span>
      <div class="object-tree-meta">#daac2d2e · 500 pts</div>
    </li>`,
  ).join("")}
  </ul>
</div></div>
</div></aside>
</div></div></div>`;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): Rgba {
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported computed color: ${value}`);
  const [r, g, b, a = 1] = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return { r, g, b, a };
}

/** Composite ``top`` over the opaque ``bottom`` color. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(first: Rgba, second: Rgba): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

const sameColor = (first: Rgba, second: Rgba) =>
  [first.r - second.r, first.g - second.g, first.b - second.b].every(
    (delta) => Math.abs(delta) < 1,
  );

interface Measure {
  /** Background layers, from the measured element up to ``html``. */
  layers: string[];
  /** Background of the link itself (on top of ``layers``). */
  linkLayer: string;
  title: string;
  link: string;
  linkDecoration: string;
  meta: string | null;
  rowShadow: string;
}

async function measure(page: Page, selector: string): Promise<Measure> {
  return page.locator(selector).evaluate((element) => {
    const layers: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      layers.push(getComputedStyle(node).backgroundColor);
    }
    const title = element.querySelector(
      ".object-tree-title, .object-tree-group-name > span",
    ) as Element;
    const anchor = element.querySelector(".title-oid-link") as Element;
    const meta = element.querySelector(".object-tree-meta");
    const anchorStyle = getComputedStyle(anchor);
    return {
      layers,
      linkLayer: anchorStyle.backgroundColor,
      title: getComputedStyle(title).color,
      link: anchorStyle.color,
      linkDecoration: anchorStyle.textDecorationLine,
      meta: meta ? getComputedStyle(meta).color : null,
      rowShadow: getComputedStyle(element).boxShadow,
    };
  });
}

function background(layers: string[]): Rgba {
  return [...layers]
    .reverse()
    .reduce((below, layer) => over(parseColor(layer), below), {
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
}

test("object references stay readable in every object tree state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(
    `<!doctype html><html><head><style>${STYLES}</style></head>` +
      `<body>${MARKUP}</body></html>`,
  );
  const cases = [
    ...GROUP_CASES.map((cls) => `group ${cls || "normal"}`),
    ...ROW_CASES.map((cls) => `row ${cls || "normal"}`),
  ];
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const name of cases) {
      const selector = `[data-case="${name}"]`;
      for (const hovered of [false, true]) {
        await page.mouse.move(1100, 750);
        if (hovered) await page.locator(`${selector} .title-oid-link`).hover();
        const state = `${theme} / ${name}${hovered ? " / hover" : ""}`;
        const values = await measure(page, selector);
        const rowBackground = background(values.layers);
        const linkBackground = over(
          parseColor(values.linkLayer),
          rowBackground,
        );
        const title = parseColor(values.title);
        const anchor = parseColor(values.link);
        const titleRatio = contrast(title, rowBackground);
        const linkRatio = contrast(anchor, linkBackground);
        check(
          titleRatio >= MIN_CONTRAST,
          `${state}: title contrast ${titleRatio.toFixed(2)}:1`,
        );
        check(
          linkRatio >= MIN_CONTRAST,
          `${state}: link contrast ${linkRatio.toFixed(2)}:1`,
        );
        check(
          !sameColor(anchor, title),
          `${state}: link has the title color ${values.link}`,
        );
        check(
          values.linkDecoration.includes("underline"),
          `${state}: link is not underlined`,
        );
        if (values.meta !== null) {
          const metaRatio = contrast(parseColor(values.meta), rowBackground);
          check(
            metaRatio >= MIN_CONTRAST,
            `${state}: object id contrast ${metaRatio.toFixed(2)}:1`,
          );
        }
        if (name.includes("current")) {
          check(
            values.rowShadow !== "none",
            `${state}: current row is not marked`,
          );
        }
      }
    }

    // Keyboard focus on a link must stay visible on a selected row.
    const target = page.locator(
      '[data-case="row selected current"] .title-oid-link',
    );
    await page.locator('[data-case="row current"] .title-oid-link').focus();
    await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    const outline = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(":focus-visible"),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      };
    });
    check(
      outline.visible && outline.style !== "none" && outline.width > 0,
      `${theme}: focused link has no visible outline`,
    );
  }

  expect(failures).toEqual([]);
});
