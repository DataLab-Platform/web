/**
 * Tests for the CSS neutralisation applied to the untrusted markup of
 * notebooks (``untrustedMarkup.ts``).
 */

import { describe, expect, it } from "vitest";

import { neutralizeCss } from "../../../src/components/notebook/untrustedMarkup";

/** Whether *css* still holds a construct loading a resource. */
function loadsResource(css: string): boolean {
  return /(^|[^-])(url|image-set|image|src)\((?!\s*["']?#)|@import|@font-face/i.test(
    css,
  );
}

describe("neutralizeCss", () => {
  it.each([
    ".a { background: url(https://evil.example/a.png) }",
    ".a { background: URL( 'https://evil.example/a.png' ) }",
    ".a { background: -webkit-image-set('https://evil.example/a.png' 1x) }",
    ".a { background: image('https://evil.example/a.png') }",
    ".a { background: src('https://evil.example/a.png') }",
    "@import 'https://evil.example/a.css';",
    "@IMPORT url(https://evil.example/a.css);",
    "@font-face { font-family: f; src: url(https://evil.example/f.woff) }",
    // Comments separate tokens: removing them must not leave a bypass.
    ".a { background: ur/**/l(https://evil.example/a.png) }",
    "@im/* x */port 'https://evil.example/a.css';",
    "/* unterminated comment hides nothing: url(https://evil.example/a.png)",
  ])("neutralises %s", (css) => {
    expect(loadsResource(neutralizeCss(css))).toBe(false);
  });

  it("drops CSS holding an escape", () => {
    expect(
      neutralizeCss(".a { background: u\\72l(https://e.example/a) }"),
    ).toBe("");
  });

  it("keeps fragment references and harmless declarations", () => {
    const css = ".a { clip-path: url(#c); color: red; position: fixed }";
    expect(neutralizeCss(css)).toBe(css);
    expect(neutralizeCss(".b { mask: url( '#m' ) }")).toBe(
      ".b { mask: url( '#m' ) }",
    );
  });
});
