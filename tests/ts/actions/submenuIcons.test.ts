import { describe, it, expect } from "vitest";
import { resolveSubmenuIcon } from "../../../src/actions/submenuIcons";

describe("resolveSubmenuIcon", () => {
  it("returns undefined for paths without a registered icon", () => {
    expect(resolveSubmenuIcon("File")).toBeUndefined();
    expect(resolveSubmenuIcon("Some/Unknown/Path")).toBeUndefined();
  });

  it("returns a string URL for known submenu paths", () => {
    // ``Operations/Constant`` and ``Processing/Fitting`` are guaranteed by
    // the catalogue mirror.
    const url = resolveSubmenuIcon("Processing/Fitting");
    expect(typeof url).toBe("string");
    expect(url).not.toBe("");
  });
});
