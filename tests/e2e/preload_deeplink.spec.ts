import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

// Regression coverage for the ?preload= deep link used by the
// documentation use-case pages: the demo workspace must land in the
// object tree and be plotted, and cross-origin targets must be ignored.
test.describe("preload deep link", () => {
  test("?preload=demos/spectroscopy.h5 loads the demo workspace", async ({
    page,
  }) => {
    await page.goto("/?preload=demos/spectroscopy.h5");
    await waitForRuntimeReady(page);

    // Success toast confirms the preload path (not another loading route).
    await expect(
      page.getByText("Loaded workspace spectroscopy.h5"),
    ).toBeVisible();

    // The group and its signal are visible in the object tree, and the
    // curve is actually plotted (Plotly renders the object title).
    await expect(page.getByText("Spectroscopy demo")).toBeVisible();
    await expect(
      page.locator(".object-tree-title", { hasText: "Spectrum (paracetamol)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Spectrum (paracetamol)"),
    ).toBeVisible();
  });

  test("image-only workspace auto-switches to the Image panel", async ({
    page,
  }) => {
    await page.goto("/?preload=demos/ndt.h5");
    await waitForRuntimeReady(page);

    await expect(page.getByText("Loaded workspace ndt.h5")).toBeVisible();

    // Without the auto-switch the app stayed on the (empty) Signal panel.
    await expect(page.getByText("NDT demo")).toBeVisible();
    await expect(
      page.locator(".object-tree-title", {
        hasText: "Inspection image (synthetic defects)",
      }),
    ).toBeVisible();
  });

  test("standalone ?panel=image opens on the Image panel", async ({ page }) => {
    await page.goto("/?panel=image");
    await waitForRuntimeReady(page);

    await expect(page.getByRole("tab", { name: "Images" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("cross-origin ?preload= is ignored", async ({ page }) => {
    await page.goto("/?preload=https://evil.example.com/x.h5");
    await waitForRuntimeReady(page);

    await expect(page.locator(".status")).toHaveText("Ready");
    // Neither loaded nor errored: the parameter is silently rejected.
    await expect(page.getByText("Loaded workspace")).toHaveCount(0);
    await expect(page.getByText("Failed to preload")).toHaveCount(0);
  });
});
