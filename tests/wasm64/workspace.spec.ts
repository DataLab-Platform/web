import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forceSaveDownloadFallback,
  waitForRuntimeReady,
} from "../e2e/fixtures";

const fixture = fileURLToPath(
  new URL("../../build/wasm64/fixtures/source.h5", import.meta.url),
);

async function openWorkspace(page: Page, path: string) {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /Open HDF5 files/i }).click();
  await (await chooser).setFiles(path);
  await expect(page).toHaveTitle(`DataLab-Web — ${basename(path)}`, {
    timeout: 30_000,
  });
}

test("static UI: open, filter, export and reopen an HDF5 workspace", async ({
  page,
}, info) => {
  const engine = process.env.DLW_TEST_ENGINE ?? "wasm64";
  if (!["pyodide", "wasm64"].includes(engine))
    throw new Error("Invalid test engine");
  const start = Date.now();
  const blocked: string[] = [];
  if (engine === "wasm64") {
    await page.context().route("**/*", (route) => {
      if (
        route.request().url().startsWith("http://127.0.0.1:49139/web-wasm64/")
      )
        return route.continue();
      blocked.push(route.request().url());
      return route.abort();
    });
  }
  page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(msg.text().slice(0, 600));
  });
  await page.goto(
    engine === "wasm64" ? "./" : "./?runtime=worker&engine=pyodide",
  );
  await expect(page.locator(".app")).not.toHaveAttribute(
    "data-runtime-status",
    "loading",
    { timeout: 180000 },
  );
  const app = page.locator(".app");
  if ((await app.getAttribute("data-runtime-status")) === "error")
    throw new Error(await app.innerText());
  await waitForRuntimeReady(page);
  await expect(page.locator(".wasm64-demo-banner")).toContainText(
    "Operation above 4 GiB has not been verified.",
  );
  expect(await page.evaluate(() => "runtime" in window)).toBe(false);
  if (engine === "wasm64")
    await expect(page.locator(".app")).toHaveAttribute("data-engine", "wasm64");
  console.log(`${engine} ready in ${Date.now() - start} ms`);
  await openWorkspace(page, fixture);
  await page.getByRole("tab", { name: "Images", exact: true }).click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: "Reference image" })
    .click();
  await page
    .getByRole("menuitem", { name: "Processing", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /^Noise reduction/ }).hover();
  await page.getByRole("menuitem", { name: /Gaussian filter/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="number"]').first().fill("1.25");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator(".object-tree-item")).toHaveCount(2);
  await expect(page).toHaveTitle(/•/);
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /Open HDF5 files/i }).click();
  await (
    await chooser
  ).setFiles({
    name: "invalid.h5",
    mimeType: "application/x-hdf",
    buffer: Buffer.from("not HDF5"),
  });
  await expect(dialog).toContainText("Failed to open HDF5");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page).toHaveTitle(/•/);
  await expect(page.locator(".object-tree-item")).toHaveCount(2);
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    });
  });
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /Save to HDF5 file/i }).click();
  await expect(page).toHaveTitle(/•/);
  await forceSaveDownloadFallback(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "File", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /Save to HDF5 file/i }).click();
  const output = info.outputPath(`${engine}.h5`);
  const file = await download;
  await file.saveAs(output);
  await expect(page).toHaveTitle(`DataLab-Web — ${file.suggestedFilename()}`);
  await page.reload();
  await waitForRuntimeReady(page);
  await openWorkspace(page, output);
  await page.getByRole("tab", { name: "Images", exact: true }).click();
  await expect(page.locator(".object-tree-item")).toHaveCount(2);
  await page.getByRole("tab", { name: "Signals", exact: true }).click();
  await expect(
    page.locator(".object-tree-item").filter({ hasText: "Reference signal" }),
  ).toBeVisible();
  const python =
    process.env.DLW_REFERENCE_PYTHON ??
    fileURLToPath(
      new URL(
        process.platform === "win32"
          ? "../../.venv/Scripts/python.exe"
          : "../../.venv/bin/python",
        import.meta.url,
      ),
    );
  const oracle = fileURLToPath(
    new URL("./native_workspace.py", import.meta.url),
  );
  console.log(
    execFileSync(python, ["-I", oracle, "verify", output], {
      encoding: "utf8",
    }),
  );
  expect(blocked).toEqual([]);
});

test("a missing WASM64 manifest is a visible failure, not a hidden Pyodide fallback", async ({
  page,
}) => {
  const urls: string[] = [];
  page.context().on("request", (request) => urls.push(request.url()));
  await page
    .context()
    .route("**/environment.json", (route) =>
      route.fulfill({ status: 404, body: "missing test fixture" }),
    );
  await page.goto("./");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-runtime-status",
    "error",
    { timeout: 30000 },
  );
  await expect(page.getByText("WASM64 environment: HTTP 404")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Restart in Pyodide" }),
  ).toHaveAttribute("href", "?engine=pyodide");
  expect(urls.some((url) => url.includes("cdn.jsdelivr.net/pyodide"))).toBe(
    false,
  );
});
