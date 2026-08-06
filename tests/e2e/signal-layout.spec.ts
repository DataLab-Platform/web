import { expect } from "@playwright/test";
import { test, dismissAnyDialog } from "./fixtures-warm";

test.describe.serial("multi-signal plot layout", () => {
  test.beforeEach(async ({ warmPage: page }) => {
    await dismissAnyDialog(page);
    await page.evaluate(async () => {
      await window.runtime.resetAll();
      localStorage.removeItem("datalab-web.signal-axis-groups");
      localStorage.removeItem("datalab-web.signal-layout-mode");
    });
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();
  });

  test("switches selected signals between overlay, vertical and horizontal", async ({
    warmPage: page,
  }) => {
    test.setTimeout(360_000);
    await page.evaluate(async () => {
      const x = Array.from({ length: 32 }, (_, index) => index / 10);
      for (let index = 0; index < 3; index += 1) {
        await window.runtime.addSignalFromArrays({
          title: `layout-${index}`,
          xdata: x,
          ydata: x.map((value) => Math.sin(value + index)),
          xlabel: "Time",
          xunit: "s",
          ylabel: "Amplitude",
          yunit: "V",
        });
      }
    });
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();

    const items = page.locator(".object-tree-item");
    await items.filter({ hasText: "layout-0" }).first().click();
    await items
      .filter({ hasText: "layout-1" })
      .first()
      .click({ modifiers: ["Control"] });
    await items
      .filter({ hasText: "layout-2" })
      .first()
      .click({ modifiers: ["Control"] });

    const readLayout = () =>
      page.evaluate(() => {
        const gd = document.querySelector(
          ".signal-plot-canvas .js-plotly-plot",
        ) as
          | (HTMLElement & {
              data?: Array<{ uid?: string; xaxis?: string; yaxis?: string }>;
              layout?: Record<
                string,
                { domain?: [number, number]; matches?: string }
              >;
            })
          | null;
        return {
          traces: (gd?.data ?? [])
            .filter((trace) => trace.uid)
            .map((trace) => ({
              xaxis: trace.xaxis ?? "x",
              yaxis: trace.yaxis ?? "y",
            })),
          x1: gd?.layout?.xaxis?.domain ?? [0, 1],
          x2: gd?.layout?.xaxis2?.domain ?? [0, 1],
          y1: gd?.layout?.yaxis?.domain ?? [0, 1],
          y2: gd?.layout?.yaxis2?.domain ?? [0, 1],
          matches: gd?.layout?.xaxis2?.matches ?? null,
          stored: localStorage.getItem("datalab-web.signal-layout-mode"),
          storedAxisGroups: localStorage.getItem(
            "datalab-web.signal-axis-groups",
          ),
        };
      });

    await page.getByRole("button", { name: "Organize axes…" }).click();
    const dialog = page.getByRole("dialog", { name: "Organize signal axes" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Vertical" }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("combobox").nth(1).selectOption({ index: 0 });
    await dialog.getByRole("button", { name: "Apply" }).click();

    await expect(
      page.getByRole("button", { name: "Vertical" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await readLayout()).traces.map((trace) => trace.yaxis))
      .toEqual(["y", "y", "y2"]);
    let snapshot = await readLayout();
    expect(snapshot.y1[0]).toBeGreaterThan(snapshot.y2[1]);
    expect(snapshot.matches).toBe("x");
    expect(snapshot.stored).toBe("vertical");
    expect(JSON.parse(snapshot.storedAxisGroups ?? "{}")).toMatchObject({
      version: 1,
    });

    await page.getByRole("button", { name: "Horizontal" }).click();
    await expect
      .poll(async () => (await readLayout()).traces.map((trace) => trace.xaxis))
      .toEqual(["x", "x", "x2"]);
    snapshot = await readLayout();
    expect(snapshot.x1[1]).toBeLessThan(snapshot.x2[0]);
    expect(snapshot.stored).toBe("horizontal");

    await page.getByRole("button", { name: "Organize axes…" }).click();
    await dialog.getByRole("button", { name: "Vertical" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("button", { name: "Horizontal" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await readLayout()).traces.map((trace) => trace.xaxis))
      .toEqual(["x", "x", "x2"]);
    expect((await readLayout()).stored).toBe("horizontal");

    await page.getByRole("button", { name: "Overlay" }).click();
    await expect
      .poll(async () => (await readLayout()).traces.map((trace) => trace.xaxis))
      .toEqual(["x", "x", "x"]);

    await page.getByRole("button", { name: "Vertical" }).click();
    await items.filter({ hasText: "layout-0" }).first().click();
    await items
      .filter({ hasText: "layout-1" })
      .first()
      .click({ modifiers: ["Control"] });
    await items
      .filter({ hasText: "layout-2" })
      .first()
      .click({ modifiers: ["Control"] });
    await expect
      .poll(async () => (await readLayout()).traces.map((trace) => trace.yaxis))
      .toEqual(["y", "y", "y2"]);
  });
});
