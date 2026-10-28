import { describe, expect, it } from "vitest";
import {
  DEFAULT_MACRO_TITLE,
  deriveMacroTitle,
  extractMacroCodeBlocks,
} from "../../../src/aiassistant/macroCodeBlocks";

describe("aiassistant/macroCodeBlocks", () => {
  it("extracts python and py fences in document order", () => {
    const text = [
      "Use this macro:",
      "",
      "```python",
      "import numpy as np",
      "print(np.pi)",
      "```",
      "",
      "Or the short one:",
      "",
      "```py",
      "print(1)",
      "```",
    ].join("\n");
    expect(extractMacroCodeBlocks(text)).toEqual([
      "import numpy as np\nprint(np.pi)",
      "print(1)",
    ]);
  });

  it("keeps unlabelled fences only when they look like a macro", () => {
    const text = [
      "```",
      "x = await proxy.get_object()",
      "```",
      "",
      "```",
      "just some text",
      "```",
    ].join("\n");
    expect(extractMacroCodeBlocks(text)).toEqual([
      "x = await proxy.get_object()",
    ]);
  });

  it("ignores fences of other languages and inline code", () => {
    const text = [
      "Run `import numpy` first.",
      "",
      "```bash",
      "pip install numpy",
      "```",
      "",
      "```json",
      '{"import": 1}',
      "```",
    ].join("\n");
    expect(extractMacroCodeBlocks(text)).toEqual([]);
  });

  it("finds python fences nested in lists", () => {
    const text = [
      "1. Step one:",
      "",
      "   ```python",
      "   print(2)",
      "   ```",
    ].join("\n");
    expect(extractMacroCodeBlocks(text)).toEqual(["print(2)"]);
  });

  it("returns nothing for empty text", () => {
    expect(extractMacroCodeBlocks("")).toEqual([]);
    expect(extractMacroCodeBlocks("   ")).toEqual([]);
  });

  it("names the macro after the user request", () => {
    expect(deriveMacroTitle("Write a macro that generates a curve")).toBe(
      "Write a macro that generates a curve",
    );
    expect(deriveMacroTitle("x".repeat(100)).length).toBeLessThanOrEqual(60);
    expect(deriveMacroTitle(null)).toBe(DEFAULT_MACRO_TITLE);
    expect(deriveMacroTitle("  ")).toBe(DEFAULT_MACRO_TITLE);
  });
});
