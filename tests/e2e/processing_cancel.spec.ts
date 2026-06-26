/**
 * Interruptible processing — permanent end-to-end regression suite.
 *
 * Guards the cancellable processing path: a built-in feature runs in a
 * **separate, disposable** Pyodide compute worker (so a long call can be
 * cancelled by terminating it, with no ``SharedArrayBuffer`` — see
 * ``ProcessingOrchestrator`` / ``computeWorker.ts``). A break anywhere in the
 * chain — kernel ``extractFeatureInputs`` → the worker's second Pyodide
 * running ``run_feature_serialized`` → kernel ``commitFeatureResults`` — would
 * throw or yield a wrong result, neither of which a unit test can catch (only
 * the worker's real Pyodide boot + pickle/JSON bridge exercise it).
 *
 * The orchestrator is exposed on ``window.orchestrator`` in dev mode, mirroring
 * ``window.runtime`` (both used by the existing E2E specs). One worker boot is
 * amortised across the assertions, which run ``serial``.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

interface E2ERuntime {
  addSignalFromArrays(p: {
    title: string;
    xdata: number[];
    ydata: number[];
  }): Promise<string>;
  getSignalData(id: string): Promise<{ x: number[]; y: number[] }>;
  listSignals(): Promise<{ id: string; title: string }[]>;
  resetAll(): Promise<void>;
}
interface E2EOrchestrator {
  runFeature(input: {
    featureId: string;
    sourceIds: string[];
    operandId?: string | null;
    params?: Record<string, unknown> | null;
  }): Promise<string[]>;
  cancel(): void;
}

test.describe.serial("interruptible processing (E2E)", () => {
  // Generous budget: the compute worker boots a *second* Pyodide (Pyodide
  // download + Sigima micropip install) on the first delegated run.
  test.describe.configure({ timeout: 300_000 });

  let context: Awaited<ReturnType<Browser["newContext"]>>;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));
    await page.goto("/");
    await waitForRuntimeReady(page);
    // The orchestrator appears once the runtime is ready (dev-only global).
    await page.waitForFunction(
      () =>
        (window as unknown as { orchestrator?: unknown }).orchestrator != null,
      undefined,
      { timeout: 60_000 },
    );
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("delegated feature runs in the compute worker and commits a correct result", async () => {
    const result = await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      const orch = (window as unknown as { orchestrator: E2EOrchestrator })
        .orchestrator;
      await runtime.resetAll();
      const x = Array.from({ length: 128 }, (_, i) => i);
      const y = x.map((v) => v * 2); // normalises (min-max) to 0..1
      const src = await runtime.addSignalFromArrays({
        title: "raw",
        xdata: x,
        ydata: y,
      });
      const before = (await runtime.listSignals()).length;
      const newIds = await orch.runFeature({
        featureId: "normalize",
        sourceIds: [src],
      });
      const after = (await runtime.listSignals()).length;
      const data = await runtime.getSignalData(newIds[0]);
      return {
        newCount: newIds.length,
        grew: after - before,
        ymin: Math.min(...data.y),
        ymax: Math.max(...data.y),
      };
    });
    expect(result.newCount).toBe(1);
    expect(result.grew).toBe(1);
    expect(result.ymin).toBeCloseTo(0, 6);
    expect(result.ymax).toBeCloseTo(1, 6);
  });

  test("cancel terminates the worker; the next run lazily respawns it", async () => {
    const ok = await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      const orch = (window as unknown as { orchestrator: E2EOrchestrator })
        .orchestrator;
      const [src] = (await runtime.listSignals()).map((s) => s.id);
      // Terminate the current compute worker, then run again: the orchestrator
      // must transparently spawn a fresh worker and still produce a result.
      orch.cancel();
      const reIds = await orch.runFeature({
        featureId: "normalize",
        sourceIds: [src],
      });
      return reIds.length === 1;
    });
    expect(ok).toBe(true);
  });
});
