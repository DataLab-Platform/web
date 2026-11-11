/**
 * Helpers of the W3 showcase scenario (capsule and provenance): the capsule
 * dialog, saves captured in the page and the revision store memento.
 */

import { t } from "../../i18n/translate";
import { deleteRevision, listRevisions } from "../../storage/capsuleRevisions";
import { isVisible, type ShowcaseContext } from "../engine";

export const CAPSULE_DIALOG = '[data-testid="capsule-dialog"]';

/** Element of the capsule dialog by its ``data-testid``. */
export function capsuleTestId(id: string): string {
  return `${CAPSULE_DIALOG} [data-testid="${id}"]`;
}

/** Visible Close button of the capsule dialog (``null`` when closed). */
function closeButton(): HTMLButtonElement | null {
  const dialog = document.querySelector(CAPSULE_DIALOG);
  if (!isVisible(dialog)) return null;
  const labels = [t("Close"), "Close"];
  return (
    [
      ...dialog.querySelectorAll<HTMLButtonElement>(":scope > .actions button"),
    ].find((button) => labels.includes((button.textContent ?? "").trim())) ??
    null
  );
}

/** The capsule dialog is closed, or idle (its buttons are enabled while no
 *  task runs). */
function dialogIdle(): boolean {
  const close = closeButton();
  return close === null || !close.disabled;
}

/** Close the capsule dialog with its Close button, once idle. */
export async function closeCapsuleDialog(ctx: ShowcaseContext): Promise<void> {
  if (!closeButton()) return;
  const close = await ctx.waitFor(
    () => (dialogIdle() ? closeButton() : null),
    60_000,
    "the capsule dialog to be idle",
  );
  await ctx.click(close);
  await ctx.waitFor(
    () => closeButton() === null,
    5_000,
    "the capsule dialog to close",
  );
}

/** Close the capsule dialog with plain DOM clicks (no pointer, no abort
 *  check: also after the showcase was quit). */
export async function forceCloseCapsuleDialog(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (closeButton() && !dialogIdle() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  closeButton()?.click();
}

/** Bring ``el`` into view inside its scrolling container (the dialog). */
export async function reveal(
  ctx: ShowcaseContext,
  el: HTMLElement,
): Promise<void> {
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  await ctx.waitFor(() => isVisible(el), 2_000, "the element to show");
  // One frame for the scroll to apply before the spotlight reads the box.
  await new Promise((resolve) => window.setTimeout(resolve, 50));
}

// -- Saves -------------------------------------------------------------------

interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

/**
 * Run ``action`` (e.g. a click on "Save the review…") and capture the file
 * it saves, in the page: no native "Save as" dialog opens and nothing is
 * downloaded. The save goes through the File System Access API
 * (``showSaveFilePicker``, see ``utils/saveFile.ts``): a stand-in answers
 * it with an in-memory file while the save runs, and the classic download
 * fallback (``<a download>``) is swallowed meanwhile. The stand-ins are
 * removed once the capsule dialog is idle again (never while the save may
 * still reach them).
 */
export async function captureSave(
  ctx: ShowcaseContext,
  action: () => Promise<void>,
  timeoutMs = 60_000,
): Promise<File> {
  const saved: { file: File | null } = { file: null };
  const fakePicker = async (options?: { suggestedName?: string }) => {
    const name = options?.suggestedName || "document";
    return {
      name,
      async createWritable(): Promise<WritableLike> {
        const parts: Blob[] = [];
        return {
          async write(data: Blob) {
            parts.push(data);
          },
          async close() {
            saved.file = new File(parts, name);
          },
        };
      },
    };
  };
  const key = "showSaveFilePicker";
  const own = Object.getOwnPropertyDescriptor(window, key);
  Object.defineProperty(window, key, {
    configurable: true,
    writable: true,
    value: fakePicker,
  });
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.hasAttribute("download")) {
      ctx.log(`download of ${this.download} swallowed`);
      return;
    }
    anchorClick.call(this);
  };
  const restore = () => {
    if (own) Object.defineProperty(window, key, own);
    else delete (window as unknown as Record<string, unknown>)[key];
    HTMLAnchorElement.prototype.click = anchorClick;
  };
  try {
    await action();
    await ctx.waitFor(() => saved.file, timeoutMs, "the file to be saved");
    return saved.file as unknown as File;
  } finally {
    if (dialogIdle()) {
      restore();
    } else {
      // The save may still be under way (e.g. the showcase was quit).
      void (async () => {
        const deadline = Date.now() + 120_000;
        while (!dialogIdle() && Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 200));
        }
        restore();
      })();
    }
  }
}

// -- Revision store ------------------------------------------------------------

/**
 * Keep the capsule revisions of this browser as they were: inspecting a
 * capsule records it (Capsule dialog, Revisions tab); the returned function
 * forgets the revisions recorded since.
 */
export async function guardRevisions(): Promise<() => Promise<void>> {
  let known: Set<string> | null = null;
  try {
    known = new Set((await listRevisions()).map((r) => r.fingerprint));
  } catch (error) {
    console.warn("[showcase:w3] revision store unavailable", error);
  }
  return async () => {
    if (!known) return;
    try {
      for (const revision of await listRevisions()) {
        if (!known.has(revision.fingerprint)) {
          await deleteRevision(revision.fingerprint);
        }
      }
    } catch (error) {
      console.warn("[showcase:w3] revision store clean-up failed", error);
    }
  };
}
