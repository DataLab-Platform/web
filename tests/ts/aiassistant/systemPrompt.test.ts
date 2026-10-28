import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../../../src/aiassistant/systemPrompt";
import { BUILTIN_TOOLS, indexTools } from "../../../src/aiassistant/tools";

/** Prompt with whitespace collapsed (line wrapping is not significant). */
const PROMPT = SYSTEM_PROMPT.replace(/\s+/g, " ");

function kindsOf(toolName: string): string[] {
  const tool = indexTools(BUILTIN_TOOLS).get(toolName)!;
  const props = tool.parameters.properties as Record<
    string,
    { enum?: string[] }
  >;
  return props.kind?.enum ?? [];
}

describe("aiassistant/systemPrompt", () => {
  it("lists exactly the kinds supported by the creation tools", () => {
    // The prompt must not send the model to a creation tool for a shape
    // the tool cannot produce (it then falls back to plain-text code).
    for (const tool of ["create_synthetic_signal", "create_synthetic_image"]) {
      const kinds = kindsOf(tool);
      expect(kinds.length).toBeGreaterThan(0);
      expect(PROMPT).toContain(`(${kinds.join(", ")})`);
    }
    expect(PROMPT).not.toMatch(/never write a macro just to plot/i);
  });

  it("routes unsupported shapes and macro-writing requests to the macro tool", () => {
    expect(PROMPT).toContain(
      "For any other shape (e.g. a super-Gaussian, a Lorentzian, a polynomial), write a macro with 'create_and_run_macro'",
    );
    expect(PROMPT).toContain(
      "call 'create_and_run_macro' with 'autorun' set to false",
    );
    expect(PROMPT).toContain(
      "NEVER paste the code of a macro in your reply instead of calling the tool",
    );
  });
});
