import type { ShowcaseScenario } from "../engine";
import { w1Imaging } from "./w1_imaging";
import { w2Python } from "./w2_python";
import { w3Capsule } from "./w3_capsule";
import { w4AiAssistant } from "./w4_ai_assistant";

/** Native showcase scenarios, in playing order (application scenarios
 *  are interleaved by the registry, see ``../index.ts``). */
export const NATIVE_SCENARIOS: ShowcaseScenario[] = [
  w1Imaging,
  w2Python,
  w3Capsule,
  w4AiAssistant,
];
