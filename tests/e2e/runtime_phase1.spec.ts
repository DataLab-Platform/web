import { test, expect } from "@playwright/test";
import { waitForSigimaReady } from "./fixtures";

/**
 * Phase 1 validation: serialisation queue + PyProxy hygiene.
 *
 * These tests drive the runtime directly via ``window.sigima`` (exposed in
 * dev mode by ``SigimaContext``) so they assert the invariants without
 * depending on the rest of the UI.
 */
test.describe("Phase 1 — Pyodide runtime hardening", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await waitForSigimaReady(page);
    });

    test("serialises parallel callPy invocations (no state corruption)", async ({
        page,
    }) => {
        // Fire 10 parallel signal-creation calls.  With the queue, every Python
        // call observes a fully consistent ``_STORE`` so the 10 signals are
        // added.  Without it, concurrent ``_STORE[id] = obj`` writes could
        // interleave and lose entries.
        const titles = await page.evaluate(async () => {
            const sigima = (window as any).sigima;
            const x = Array.from({ length: 16 }, (_, i) => i);
            const tasks = Array.from({ length: 10 }, (_, i) =>
                sigima.addSignalFromArrays({
                    title: `phase1-${i}`,
                    xdata: x,
                    ydata: x.map((v) => v * (i + 1)),
                }),
            );
            await Promise.all(tasks);
            const signals = await sigima.listSignals();
            return signals
                .map((s: { title: string }) => s.title)
                .filter((t: string) => t.startsWith("phase1-"));
        });
        expect(titles).toHaveLength(10);
        // Insertion order must be preserved (queue == FIFO).
        for (let i = 0; i < 10; i += 1) {
            expect(titles[i]).toBe(`phase1-${i}`);
        }
    });

    test("a failing call does not poison the queue", async ({ page }) => {
        // 1) Fire an intentionally bad call (unknown signal id).  The promise
        //    rejects.
        // 2) Fire a healthy call right after.  It must resolve normally,
        //    proving the queue's ``.catch`` keeps the chain alive.
        const result = await page.evaluate(async () => {
            const sigima = (window as any).sigima;
            let badRejected = false;
            try {
                await sigima.getSignalData("does-not-exist");
            } catch {
                badRejected = true;
            }
            const signals = await sigima.listSignals();
            return { badRejected, ok: Array.isArray(signals) };
        });
        expect(result.badRejected).toBe(true);
        expect(result.ok).toBe(true);
    });

    test("interleaved bad/good calls all reach Python in order", async ({
        page,
    }) => {
        // Fire alternating good/bad calls in parallel; the queue serialises
        // them so good ones still succeed and bad ones still reject — no race
        // conditions, no swallowed errors.
        const summary = await page.evaluate(async () => {
            const sigima = (window as any).sigima;
            const x = [0, 1, 2, 3];
            const tasks: Promise<unknown>[] = [];
            for (let i = 0; i < 5; i += 1) {
                tasks.push(
                    sigima.addSignalFromArrays({
                        title: `mix-${i}`,
                        xdata: x,
                        ydata: x,
                    }),
                );
                tasks.push(
                    sigima.getSignalData("nope-" + i).catch(() => "rejected"),
                );
            }
            const results = await Promise.all(tasks);
            const titles = (await sigima.listSignals())
                .map((s: { title: string }) => s.title)
                .filter((t: string) => t.startsWith("mix-"));
            return {
                rejections: results.filter((r) => r === "rejected").length,
                creations: titles.length,
            };
        });
        expect(summary.rejections).toBe(5);
        expect(summary.creations).toBe(5);
    });
});
