import { Buffer } from "node:buffer";

import { expect, test, type Page } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

const PLUGIN_ID = "org.example.local-wheel-application";
const RECIPE_ID = `${PLUGIN_ID}:generate-curve`;
const WHEEL_FILENAME = "local_wheel_application-1.0.0-py3-none-any.whl";
const DIST_INFO = "local_wheel_application-1.0.0.dist-info";

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localParts.push(localHeader, filename, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(filename.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, filename);
    localOffset += localHeader.length + filename.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildPluginWheel(): Buffer {
  const webPlugin = `
import numpy as np

from datalab.plugins import PluginBase, PluginCapability, PluginInfo
from datalab.recipes import (
    RecipeDescriptor,
    RecipeObjectOutput,
    RecipeOutcome,
)
from sigima.objects import create_signal

PLUGIN_ID = "${PLUGIN_ID}"


def generate_curve(_inputs, _parameters, context):
    context.report_progress(0.5, "Generating local curve")
    signal = create_signal(
        "Local wheel curve",
        np.asarray([0.0, 1.0, 2.0]),
        np.asarray([0.0, 1.0, 4.0]),
    )
    return RecipeOutcome(objects=(RecipeObjectOutput("curve", signal),))


GENERATE_CURVE = RecipeDescriptor(
    recipe_id="${RECIPE_ID}",
    plugin_version="1.0.0",
    title="Generate local curve",
    version="1.0.0",
    run=generate_curve,
    description="Create a curve from a user-installed plugin wheel.",
)


class LocalWheelApplication(PluginBase):
    PLUGIN_INFO = PluginInfo(
        id=PLUGIN_ID,
        name="Local Wheel Application",
        version="1.0.0",
        description="A portable user wheel used by the browser lifecycle test.",
        capabilities=(PluginCapability.APPLICATION,),
    )
    RECIPES = (GENERATE_CURVE,)

    def create_actions(self):
        pass
`;

  return buildStoredZip({
    "local_wheel_application/__init__.py": "",
    "local_wheel_application/web.py": webPlugin,
    [`${DIST_INFO}/METADATA`]: [
      "Metadata-Version: 2.3",
      "Name: local-wheel-application",
      "Version: 1.0.0",
      "Requires-Python: >=3.11",
      "Requires-Dist: datalab-platform>=1.3",
      "",
    ].join("\n"),
    [`${DIST_INFO}/WHEEL`]: [
      "Wheel-Version: 1.0",
      "Generator: DataLab-Web Playwright",
      "Root-Is-Purelib: true",
      "Tag: py3-none-any",
      "",
    ].join("\n"),
    [`${DIST_INFO}/entry_points.txt`]: [
      "[datalab.web_plugins]",
      "local_wheel = local_wheel_application.web:LocalWheelApplication",
      "",
    ].join("\n"),
    [`${DIST_INFO}/top_level.txt`]: "local_wheel_application\n",
  });
}

async function openPluginsMenu(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "Plugins", exact: true }).click();
}

async function openPluginManager(page: Page): Promise<void> {
  await openPluginsMenu(page);
  await page.getByRole("menuitem", { name: "Manage plugins…" }).click();
  await expect(
    page.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeVisible();
}

async function openApplications(page: Page) {
  await page.getByRole("menuitem", { name: "Applications…" }).click();
  const dialog = page.getByRole("dialog", { name: "Applications" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close" }).last().click();
}

test("local plugin wheel persists and follows its managed lifecycle", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const wheel = buildPluginWheel();
  await openPluginManager(page);
  await page.locator('input[type="file"][accept=".whl"]').setInputFiles({
    name: WHEEL_FILENAME,
    mimeType: "application/octet-stream",
    buffer: wheel,
  });

  await expect(
    page.getByRole("heading", { name: "Install plugin wheel?" }),
  ).toBeVisible();
  await expect(page.getByText("local-wheel-application 1.0.0")).toBeVisible();
  await expect(page.getByText("py3-none-any", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "local_wheel = local_wheel_application.web:LocalWheelApplication",
    ),
  ).toBeVisible();
  await page.getByText("Dependencies", { exact: true }).click();
  await expect(page.getByText("datalab-platform>=1.3")).toBeVisible();
  await expect(page.getByText(/not sandboxed/)).toBeVisible();
  await page.getByRole("button", { name: "Trust & install" }).click();

  let pluginRow = page
    .getByRole("row")
    .filter({ hasText: "Local Wheel Application" });
  await expect(pluginRow).toContainText("User wheel");
  await expect(pluginRow).toContainText("unverified");
  await expect(pluginRow).toContainText("loaded");
  await closeDialog(page);

  let applications = await openApplications(page);
  await applications
    .getByRole("button")
    .filter({ hasText: "Local Wheel Application" })
    .click();
  await expect(applications.getByText("Generate local curve")).toBeVisible();
  await closeDialog(page);

  await page.reload();
  await waitForRuntimeReady(page);
  const restored = await page.evaluate(async (pluginId) => {
    const plugin = (await window.runtime.listPlugins()).find(
      (record) => record.plugin_id === pluginId,
    );
    return plugin
      ? {
          source: plugin.source,
          trust: plugin.trust,
          enabled: plugin.enabled,
          loaded: plugin.loaded,
        }
      : null;
  }, PLUGIN_ID);
  expect(restored).toEqual({
    source: "user-wheel",
    trust: "unverified",
    enabled: true,
    loaded: true,
  });

  applications = await openApplications(page);
  await applications
    .getByRole("button")
    .filter({ hasText: "Local Wheel Application" })
    .click();
  await applications.getByRole("button", { name: "Start analysis…" }).click();
  await expect(applications).toContainText("Created 1 objects");
  await closeDialog(page);
  await expect(
    page.locator(".object-tree-item").filter({ hasText: "Local wheel curve" }),
  ).toBeVisible();

  await openPluginManager(page);
  pluginRow = page
    .getByRole("row")
    .filter({ hasText: "Local Wheel Application" });
  await pluginRow.getByRole("button", { name: "Disable" }).click();
  await expect(pluginRow).toContainText("disabled");
  await expect(pluginRow.getByRole("button", { name: "Enable" })).toBeVisible();
  await closeDialog(page);

  applications = await openApplications(page);
  await expect(applications.getByText("Local Wheel Application")).toHaveCount(
    0,
  );
  await closeDialog(page);

  await openPluginManager(page);
  pluginRow = page
    .getByRole("row")
    .filter({ hasText: "Local Wheel Application" });
  await pluginRow.getByRole("button", { name: "Enable" }).click();
  await expect(pluginRow).toContainText("loaded");
  await pluginRow.getByRole("button", { name: "Remove" }).click();
  await expect(pluginRow).toHaveCount(0);
  await closeDialog(page);

  await page.reload();
  await waitForRuntimeReady(page);
  expect(
    await page.evaluate(
      async (pluginId) =>
        (await window.runtime.listPlugins()).some(
          (record) => record.plugin_id === pluginId,
        ),
      PLUGIN_ID,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      (filename) =>
        JSON.parse(
          localStorage.getItem("datalab-web/trusted-plugins") ?? "[]",
        ).some((entry: { filename?: string }) => entry.filename === filename),
      WHEEL_FILENAME,
    ),
  ).toBe(false);
});
