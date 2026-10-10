import { expect } from "@playwright/test";
import { test, dismissAnyDialog } from "./fixtures-warm";

// Bridge dialogs resolve ``active`` states and display callbacks while the
// Python call that opened them is still pending (Add metadata as the case).
test("Add metadata previews and applies values extracted from titles", async ({
  warmPage: page,
}) => {
  test.setTimeout(240_000);
  await dismissAnyDialog(page);
  const ids = await page.evaluate(async () => {
    await window.runtime.resetAll();
    const out: string[] = [];
    for (const title of ["Flat 5 ms 01", "Dark 01"]) {
      out.push(
        await window.runtime.addSignalFromArrays({
          title,
          xdata: [0, 1, 2],
          ydata: [0, 0, 0],
        }),
      );
    }
    return out;
  });
  await page.getByRole("tab", { name: "Images" }).click();
  await page.getByRole("tab", { name: "Signals" }).click();
  const items = page.locator(".object-tree-item");
  await items.filter({ hasText: "Flat 5 ms 01" }).first().click();
  await items
    .filter({ hasText: "Dark 01" })
    .first()
    .click({ modifiers: ["Control"] });

  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page
    .locator(".menu-item-submenu")
    .filter({ hasText: "Metadata" })
    .first()
    .hover();
  await page.getByRole("menuitem", { name: "Add metadata…" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Add metadata" }),
  });
  await expect(dialog).toBeVisible();
  const row = (label: string) =>
    dialog.locator(".dataset-form-row").filter({
      has: page.locator(".dataset-form-label", { hasText: label }),
    });

  const key = "plugin.org.example.cam.exposure_time_s";
  await row("Metadata key").locator("input").fill(key);
  await row("Value pattern").locator("input").fill("{title}");
  await row("Extraction pattern").locator("input").fill("([\\d.]+)\\s*ms");
  const scale = row("Scale factor").locator("input");
  await expect(scale).toBeDisabled();
  await row("Conversion").locator("select").selectOption("float");
  await expect(scale).toBeEnabled({ timeout: 30_000 });
  await scale.fill("0.001");

  const preview = row("Preview").locator("textarea, input");
  await expect(preview).toHaveValue(/Flat 5 ms 01: .*0\.005/, {
    timeout: 30_000,
  });
  await expect(preview).toHaveValue(/Dark 01: unchanged/);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();

  const metadata = await page.evaluate(
    (oids) =>
      Promise.all(oids.map((oid) => window.runtime.listObjectMetadata(oid))),
    ids,
  );
  expect(metadata[0].find((entry) => entry.key === key)?.value).toBe("0.005");
  expect(metadata[1].some((entry) => entry.key === key)).toBe(false);
});
