import { t } from "../../i18n/translate";
import type { ShowcaseContext } from "../engine";

/** First boot of the notebook kernel (cold browser cache included). */
export const KERNEL_TIMEOUT_MS = 240_000;

/**
 * Wait until the notebook kernel is ready. The Notebook panel boots it once
 * mounted, at start-up, and a new kernel replaces it when a workspace is
 * opened (a workspace reset keeps it). The label must stay idle for a
 * moment: a panel being mounted shows "idle" for one frame before its
 * kernel loads.
 */
export async function waitForKernel(
  ctx: ShowcaseContext,
  timeoutMs = KERNEL_TIMEOUT_MS,
): Promise<void> {
  let idleSince = 0;
  await ctx.waitFor(
    () => {
      const status = ctx.$(".nb-panel .nb-toolbar-status");
      if ((status?.textContent ?? "").trim() !== t("○ Kernel idle")) {
        idleSince = 0;
        return false;
      }
      idleSince ||= Date.now();
      return Date.now() - idleSince >= 1_000;
    },
    timeoutMs,
    "the notebook kernel to be ready",
  );
}
