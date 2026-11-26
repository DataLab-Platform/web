import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ASSETS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src/assets",
);

// The logo lettering uses a font that many systems lack (Century Gothic):
// it must be drawn as paths, never as SVG text.
describe.each(["DataLab-Banner2.svg", "DataLab-Splash.svg"])("%s", (name) => {
  it("draws its lettering as paths, independently of installed fonts", () => {
    const svg = readFileSync(resolve(ASSETS, name), "utf8");
    const textElements = svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) ?? [];
    const renderedText = textElements
      .map((element) => element.replace(/<[^>]*>/g, "").trim())
      .filter(Boolean);
    expect(renderedText).toEqual([]);
  });
});
