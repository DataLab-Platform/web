/**
 * Helpers shared by the capsule E2E specs: pages with a worker runtime, the
 * Capsule dialog, downloads and file choosers, and a local registry process.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { test, expect, type Browser, type Page } from "@playwright/test";

import { forceSaveDownloadFallback, waitForRuntimeReady } from "./fixtures";

const X = [0, 0.25, 0.5, 0.75];
const Y = [-2, 0, 1, 4];

/** Skip without DataLab-Capsule, or fail when CI requires provenance. */
export function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

export async function openPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/?runtime=worker");
  await waitForRuntimeReady(page);
  await forceSaveDownloadFallback(page);
  return page;
}

/** S0 -> S1 = S0 + 1 (opaque) -> S2 = normalize(S1, maximum) (replayable). */
export async function buildChain(page: Page): Promise<boolean> {
  return page.evaluate(
    async ({ x, y }) => {
      const runtime = window.runtime;
      const info = await runtime.getProvenanceLedger();
      if (!info.available) return false;
      const s0 = await runtime.addSignalFromArrays({
        title: "S0",
        xdata: x,
        ydata: y,
        xunit: "s",
        yunit: "",
      });
      const [s1] = await runtime.applyFeature("addition_constant", [s0], null, {
        value: 1,
      });
      await runtime.applyFeature("normalize", [s1], null, {
        method: "maximum",
      });
      return true;
    },
    { x: X, y: Y },
  );
}

export async function openDialog(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: /Workspace capsule/ }).click();
  await expect(page.getByTestId("capsule-dialog")).toBeVisible();
}

export async function closeDialog(page: Page): Promise<void> {
  await page
    .getByTestId("capsule-dialog")
    .getByRole("button", { name: "Close" })
    .click();
}

/** Click *trigger* and save the download it starts; return its path. */
export async function download(
  page: Page,
  trigger: () => Promise<void>,
  name: string,
): Promise<string> {
  const pending = page.waitForEvent("download");
  await trigger();
  const file = await pending;
  const target = test.info().outputPath(name);
  await file.saveAs(target);
  return target;
}

/** Click *trigger* and give *path* to the file chooser it opens. */
export async function choose(
  page: Page,
  trigger: () => Promise<void>,
  path: string,
): Promise<void> {
  const pending = page.waitForEvent("filechooser");
  await trigger();
  await (await pending).setFiles(path);
}

export async function exportCapsule(
  page: Page,
  name: string,
  options: { revision?: boolean } = {},
): Promise<string> {
  await page.getByRole("tab", { name: "Export" }).click();
  await page.getByTestId("capsule-name").fill(name);
  if (options.revision !== undefined) {
    await page.getByTestId("capsule-as-revision").setChecked(options.revision);
  }
  return download(
    page,
    () => page.getByTestId("capsule-export-button").click(),
    `${name}.dlcapsule`,
  );
}

export async function inspect(page: Page, path: string): Promise<void> {
  await page.getByRole("tab", { name: "Inspect" }).click();
  await choose(page, () => page.getByTestId("capsule-choose").click(), path);
  await expect(page.getByTestId("capsule-integrity-status")).toBeVisible();
}

/** Start a DataLab-Capsule registry (``registry`` extra) on a free port. */
export async function startRegistry(
  token: string,
): Promise<{ url: string; stop: () => void } | null> {
  const port = await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
  const root = mkdtempSync(path.join(tmpdir(), "dlw-registry-"));
  const child = spawn(
    process.env.DLW_REGISTRY_PYTHON ?? "python",
    [
      "-m",
      "datalab_capsule.registry_app",
      root,
      "--port",
      String(port),
      "--token-env",
      "DLW_REGISTRY_TOKEN",
      "--origin",
      "http://localhost:5173",
    ],
    { env: { ...process.env, DLW_REGISTRY_TOKEN: token }, stdio: "ignore" },
  );
  child.on("error", () => undefined);
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${url}/api/v1/status`)).ok) {
        return {
          url,
          stop: () => {
            child.kill();
            rmSync(root, { recursive: true, force: true });
          },
        };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  rmSync(root, { recursive: true, force: true });
  return null;
}
