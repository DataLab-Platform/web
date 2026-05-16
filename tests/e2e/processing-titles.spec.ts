import { expect } from "@playwright/test";
import { test, dismissAnyDialog } from "./fixtures-warm";

/**
 * ``apply_feature`` must produce titles where Sigima's ``{0}``/``{1}``
 * placeholders (PlaceholderTitleFormatter, installed by
 * ``dlw_title_format``) are substituted with the source objects' short
 * ``oid``s by ``bootstrap.patch_title_with_ids`` — mirroring the
 * DataLab desktop behaviour for 1-to-1, 2-to-1 and n-to-1 processings.
 */
test.describe.serial("Processing titles embed source oids", () => {
  test.beforeEach(async ({ warmPage: page }) => {
    await dismissAnyDialog(page);
    await page.evaluate(async () => {
      await window.runtime.resetAll();
    });
  });

  test("1-to-1 / 2-to-1 / n-to-1 titles embed source oids", async ({
    warmPage: page,
  }) => {
    const result = await page.evaluate(async () => {
      const runtime = (window as any).runtime;
      const x = Array.from({ length: 16 }, (_, i) => i / 16);
      const a = await runtime.addSignalFromArrays({
        title: "a",
        xdata: x,
        ydata: x.map((v: number) => v),
      });
      const b = await runtime.addSignalFromArrays({
        title: "b",
        xdata: x,
        ydata: x.map(() => 0.5),
      });
      const aId = (a as any).id ?? a;
      const bId = (b as any).id ?? b;
      const [norm] = await runtime.applyFeature("normalize", [aId]);
      const [diff] = await runtime.applyFeature("difference", [aId], bId);
      const [avg] = await runtime.applyFeature("average", [aId, bId]);
      const getTitle = async (oid: string) =>
        (await runtime.callPy("get_object_meta", { oid })).title as string;
      return {
        aId,
        bId,
        normTitle: await getTitle(norm),
        diffTitle: await getTitle(diff),
        avgTitle: await getTitle(avg),
      };
    });
    const { aId, bId, normTitle, diffTitle, avgTitle } = result;
    // No unresolved placeholders survive in any of the three titles.
    for (const title of [normTitle, diffTitle, avgTitle]) {
      expect(title).not.toMatch(/\{\d+\}/);
    }
    expect(normTitle).toContain(aId);
    expect(diffTitle).toContain(aId);
    expect(diffTitle).toContain(bId);
    expect(avgTitle).toContain(aId);
    expect(avgTitle).toContain(bId);
  });
});
