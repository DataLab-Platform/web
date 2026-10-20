/**
 * On-disk storage mode — end-to-end suite.
 *
 * In on-disk storage mode the heavy array of every object lives in OPFS and
 * is paged into the WebAssembly heap only for the call that needs it; at rest
 * the object holds a 1-element placeholder. This suite drives the real
 * runtime, on the UI thread and in the kernel worker, and checks that:
 *
 * - views and processing dialogs read the actual data: the signal and image
 *   view snapshots and the parameters of a dialog initialized from its source
 *   (radial profile) are the same as in RAM;
 * - an object replaced by a macro (``proxy.set_object``) keeps its new data
 *   once paged in again, instead of its earlier on-disk copy;
 * - deleting a group or resetting the workspace releases the disk space of
 *   the deleted objects.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

interface Reading {
  signalLength: number;
  signalLast: number;
  imageShape: [number, number];
  imageSum: number;
  radialValues: string;
}

interface ScenarioResult {
  ram: Reading;
  disk: Reading;
  spilledAtRest: number;
  spilledAfterReads: number;
  replacedY: number[];
  spilledAfterReplace: number;
  spilledBeforeDelete: number;
  spilledAfterDelete: number;
  bytesBeforeDelete: number;
  bytesAfterDelete: number;
  spilledAfterReset: number;
  bytesAfterReset: number;
}

async function runScenario(page: Page): Promise<ScenarioResult> {
  return page.evaluate(async () => {
    interface Runtime {
      resetAll(): Promise<void>;
      setStorageMode(mode: "ram" | "disk"): Promise<void>;
      getSpilledCount(): number;
      getDiskStoreBytes(): number;
      addSignalFromArrays(params: {
        title: string;
        xdata: number[];
        ydata: number[];
        group_id?: string | null;
      }): Promise<string>;
      addImageFromArray(params: {
        title: string;
        data: number[][];
      }): Promise<string>;
      createGroup(kind: string, name?: string): Promise<string>;
      deleteGroup(gid: string, kind: string): Promise<void>;
      getSignalViewSnapshot(
        currentId: string,
        selectedIds: string[],
      ): Promise<{ current: { y: ArrayLike<number> } } | null>;
      getImageViewSnapshot(
        currentId: string,
        selectedIds: string[],
      ): Promise<{
        images: {
          width: number;
          height: number;
          data: ArrayLike<number>[];
        }[];
      } | null>;
      getFeatureSchema(
        featureId: string,
        sourceOid?: string,
      ): Promise<{ values: Record<string, unknown> } | null>;
      setObjectPickled(pickledB64: string): Promise<string>;
      runPython(code: string): Promise<unknown>;
    }
    const runtime = (window as unknown as { runtime: Runtime }).runtime;
    await runtime.resetAll();
    await runtime.setStorageMode("ram");

    const n = 100;
    const xdata = Array.from({ length: n }, (_, i) => i);
    const ydata = xdata.map((x) => x * x);
    const signal = await runtime.addSignalFromArrays({
      title: "S",
      xdata,
      ydata,
    });
    const image = await runtime.addImageFromArray({
      title: "I",
      data: Array.from({ length: 64 }, (_, row) =>
        Array.from({ length: 48 }, (_, col) => row * 48 + col),
      ),
    });

    const read = async (): Promise<Reading> => {
      const signalView = await runtime.getSignalViewSnapshot(signal, [signal]);
      const imageView = await runtime.getImageViewSnapshot(image, [image]);
      const schema = await runtime.getFeatureSchema(
        "image:radial_profile",
        image,
      );
      const y = signalView!.current.y;
      const pixels = imageView!.images[0];
      let imageSum = 0;
      for (const row of pixels.data) {
        for (let i = 0; i < row.length; i++) imageSum += row[i];
      }
      return {
        signalLength: y.length,
        signalLast: y[y.length - 1],
        imageShape: [pixels.height, pixels.width],
        imageSum,
        radialValues: JSON.stringify(schema?.values ?? null),
      };
    };

    const ram = await read();
    await runtime.setStorageMode("disk");
    const spilledAtRest = runtime.getSpilledCount();
    const disk = await read();
    const spilledAfterReads = runtime.getSpilledCount();

    // What ``proxy.set_object`` sends back from a macro: the object, changed,
    // with its UUID (read here from the resident metadata only).
    const pickled = (await runtime.runPython(`
import base64 as _b64
import pickle as _pickle
import numpy as _np
import sigima as _sigima
_replacement = _sigima.create_signal("S", _np.arange(100.0), _np.full(100, 7.0))
_replacement.metadata["__uuid"] = _object_uuid(_MODEL.get(${JSON.stringify(signal)}))
_b64.b64encode(_pickle.dumps(_replacement)).decode("ascii")
`)) as string;
    await runtime.setObjectPickled(pickled);
    const spilledAfterReplace = runtime.getSpilledCount();
    const replaced = await runtime.getSignalViewSnapshot(signal, [signal]);
    const replacedY = Array.from(replaced!.current.y).slice(0, 3);

    const gid = await runtime.createGroup("signal", "Deleted group");
    for (let i = 0; i < 3; i++) {
      await runtime.addSignalFromArrays({
        title: `D${i}`,
        xdata,
        ydata,
        group_id: gid,
      });
    }
    const spilledBeforeDelete = runtime.getSpilledCount();
    const bytesBeforeDelete = runtime.getDiskStoreBytes();
    await runtime.deleteGroup(gid, "signal");
    const spilledAfterDelete = runtime.getSpilledCount();
    const bytesAfterDelete = runtime.getDiskStoreBytes();

    await runtime.resetAll();
    const spilledAfterReset = runtime.getSpilledCount();
    const bytesAfterReset = runtime.getDiskStoreBytes();
    await runtime.setStorageMode("ram");

    return {
      ram,
      disk,
      spilledAtRest,
      spilledAfterReads,
      replacedY,
      spilledAfterReplace,
      spilledBeforeDelete,
      spilledAfterDelete,
      bytesBeforeDelete,
      bytesAfterDelete,
      spilledAfterReset,
      bytesAfterReset,
    };
  });
}

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`on-disk storage mode (${runtimeMode})`, () => {
    test.describe.configure({ timeout: 300_000 });

    let context: Awaited<ReturnType<Browser["newContext"]>>;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      page.on("pageerror", (err) => console.log("[pageerror]", err.message));
      await page.goto(`/?runtime=${runtimeMode}`);
      await waitForRuntimeReady(page);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test("reads, replaces and deletes objects stored on disk", async () => {
      test.skip(
        !(await page.evaluate(() =>
          (
            window as unknown as {
              runtime: { isDiskStorageSupported(): boolean };
            }
          ).runtime.isDiskStorageSupported(),
        )),
        "OPFS is not available in this browser",
      );
      const result = await runScenario(page);

      // Views and dialogs read the actual data, as in RAM.
      expect(result.spilledAtRest).toBe(2);
      expect(result.ram.signalLength).toBe(100);
      expect(result.ram.signalLast).toBe(99 * 99);
      expect(result.ram.imageShape).toEqual([64, 48]);
      expect(result.disk).toEqual(result.ram);
      // Every object paged in for a read is back on disk afterwards.
      expect(result.spilledAfterReads).toBe(2);

      // A macro's replacement is not reverted by the earlier on-disk copy.
      expect(result.spilledAfterReplace).toBe(2);
      expect(result.replacedY).toEqual([7, 7, 7]);

      // Deleted objects release their disk space.
      expect(result.spilledBeforeDelete).toBe(5);
      expect(result.spilledAfterDelete).toBe(2);
      expect(result.bytesAfterDelete).toBeLessThan(result.bytesBeforeDelete);
      expect(result.spilledAfterReset).toBe(0);
      expect(result.bytesAfterReset).toBe(0);
    });
  });
}
