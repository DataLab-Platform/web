import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

/**
 * End-to-end test for the remote-control bridge: a host page embeds
 * DataLab-Web in an iframe, drives it through the ``DataLabWebClient``
 * SDK and reads results back. Exercises the full Pyodide round-trip,
 * which is the only layer where a wiring bug between the host page,
 * ``postMessage``, the bridge and ``bootstrap.py`` can surface.
 *
 * Fixture: ``public/remote-host-example.html`` — also serves as the
 * manual demo page, so the SDK contract has a single source of truth.
 */

test.describe("Remote control via postMessage", () => {
  test("host theme changes preserve the workspace and saved preference", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("datalab-web:theme", "light");
    });
    await page.goto("/remote-host-example.html");
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      {
        timeout: 180_000,
      },
    );
    const id = await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      return window.__client.addSignal("Theme probe", [0, 1], [1, 2]);
    });
    await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      await window.__client.setTheme("dark");
    });
    const iframe = page.frameLocator("#dlw");
    await expect(iframe.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(iframe.locator(".object-tree-item")).toContainText(
      "Theme probe",
    );
    const state = await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      const selection = await window.__client.getSelection();
      return {
        selection,
        savedTheme: localStorage.getItem("datalab-web:theme"),
      };
    });
    expect(state).toEqual({ selection: [id], savedTheme: "light" });
    await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      await window.__client.setTheme("light");
    });
    await expect(iframe.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("host page can push, calc and read back signals", async ({ page }) => {
    await page.goto("/remote-host-example.html");

    // The demo page sets ``data-remote-ready=1`` on <body> once the
    // SDK ``client.ready()`` resolved. Pyodide cold-start can be slow
    // on CI so we re-use the smoke-test budget.
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      { timeout: 180_000 },
    );

    // From here on, the SDK is exposed as ``window.__client``.

    // 1. Handshake: ``get_version`` resolves to a non-empty string.
    const version = await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      return await window.__client.getVersion();
    });
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);

    // 2. Push a signal, read it back, verify x/y identity.
    const pushed = await page.evaluate(async () => {
      const xs = [0, 0.5, 1, 1.5, 2];
      const ys = [0, 1, 0, -1, 0];
      // @ts-expect-error see above
      const id = await window.__client.addSignal("Probe", xs, ys);
      // @ts-expect-error see above
      const data = await window.__client.getSignalXY(id);
      return { id, x: Array.from(data.x), y: Array.from(data.y) };
    });
    expect(pushed.id).toBeTruthy();
    expect(pushed.x).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(pushed.y).toEqual([0, 1, 0, -1, 0]);

    // 2b. The DataLab-Web UI inside the iframe must auto-refresh and
    //     display the freshly added signal. This guards the
    //     ``onModelChanged`` → ``CustomEvent`` → App.tsx wiring: a
    //     regression here was the original bug ("signal doesn't appear
    //     until you switch tabs").
    const iframe = page.frameLocator("#dlw");
    await expect(iframe.locator(".object-tree-item")).toContainText("Probe", {
      timeout: 5_000,
    });

    // 3. Run a registered Sigima processing on it (FFT — always
    //    available in DataLab-Web). The result is a new object.
    const calcOutcome = await page.evaluate(async (sourceId) => {
      // @ts-expect-error see above
      const ids = await window.__client.calc("fft", null, [sourceId]);
      // @ts-expect-error see above
      const list = await window.__client.listSignals();
      return { ids, count: list.length };
    }, pushed.id);
    expect(Array.isArray(calcOutcome.ids)).toBe(true);
    expect(calcOutcome.ids.length).toBeGreaterThan(0);
    // We pushed one signal; the FFT must have produced at least one more.
    expect(calcOutcome.count).toBeGreaterThanOrEqual(2);

    // 4. List & delete: the count drops back after removing the
    //    pushed signal.
    const afterDelete = await page.evaluate(async (sourceId) => {
      // @ts-expect-error see above
      await window.__client.deleteObject(sourceId);
      // @ts-expect-error see above
      const list = await window.__client.listSignals();
      return list.length;
    }, pushed.id);
    expect(afterDelete).toBe(calcOutcome.count - 1);
  });

  test("remote selection switches panels and rejects unknown objects", async ({
    page,
  }) => {
    await page.goto("/remote-host-example.html");
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      {
        timeout: 180_000,
      },
    );

    const ids = await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      const first = await window.__client.addSignal("First", [0, 1], [1, 2]);
      // @ts-expect-error injected by the demo page
      const second = await window.__client.addSignal("Second", [0, 1], [2, 3]);
      // @ts-expect-error injected by the demo page
      const image = await window.__client.addImage("Image", [
        [1, 2],
        [3, 4],
      ]);
      return { first, second, image };
    });
    const selection = () =>
      page.evaluate(async () => {
        // @ts-expect-error injected by the demo page
        return await window.__client.getSelection();
      });
    const panel = () =>
      page.evaluate(async () => {
        // @ts-expect-error injected by the demo page
        return await window.__client.getCurrentPanel();
      });
    await expect.poll(panel).toBe("image");
    await expect.poll(selection).toEqual([ids.image]);

    const projection = await page.evaluate(async (image) => {
      // @ts-expect-error injected by the demo page
      return await window.__client.calc("image:horizontal_projection", null, [
        image,
      ]);
    }, ids.image);
    expect(projection).toHaveLength(1);
    await expect.poll(panel).toBe("signal");
    await expect.poll(selection).toEqual(projection);

    const selected = await page.evaluate(async ({ first, second }) => {
      // @ts-expect-error injected by the demo page
      await window.__client.selectObjects([first, second], "signal");
      // @ts-expect-error injected by the demo page
      return await window.__client.getSelection();
    }, ids);
    expect(selected).toEqual([ids.first, ids.second]);
    await expect.poll(selection).toEqual([ids.first, ids.second]);
    await expect(
      page.frameLocator("#dlw").locator(".object-tree-item"),
    ).toContainText(["First", "Second"]);
    const error = await page.evaluate(async () => {
      try {
        // @ts-expect-error injected by the demo page
        await window.__client.selectObjects(["missing"], "image");
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });
    expect(error).toContain("Objects not found");
    await expect.poll(panel).toBe("signal");
    await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      await window.__client.setCurrentPanel("macro");
    });
    await expect.poll(panel).toBe("macro");

    await page.evaluate(() => {
      // @ts-expect-error injected by the demo page
      window.__client.on("workspace-changed", () => {
        document.body.dataset.workspaceChanged = "1";
      });
    });
    const frame = page
      .frames()
      .find((item) => item.url().includes("/index.html?"));
    if (!frame) throw new Error("DataLab iframe not found");
    await frame.evaluate(async () => {
      // @ts-expect-error runtime is exposed by the app for browser tests
      await window.runtime.createSignalTyped("sine");
    });
    await expect(page.locator("body")).toHaveAttribute(
      "data-workspace-changed",
      "1",
    );
  });

  test("imports binary data and exports an HDF5 workspace without replacing it", async ({
    page,
  }) => {
    await page.goto("/remote-host-example.html");
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      {
        timeout: 180_000,
      },
    );
    const outcome = await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      const client = window.__client;
      const csv = new TextEncoder().encode("x,y\n0,1\n1,2\n2,3\n");
      const imported = await client.openFiles(
        [{ name: "probe.csv", bytes: csv }],
        "signal",
      );
      const id = imported.files[0].ids[0];
      const values = await client.getSignalXY(id);
      const iframe = document.querySelector<HTMLIFrameElement>("#dlw");
      if (!iframe?.contentWindow) throw new Error("iframe unavailable");
      // @ts-expect-error runtime is exposed by the app for browser tests
      const runtime = iframe.contentWindow.runtime;
      const before = await runtime.getPanelTree("signal");
      const uuid = before.groups
        .flatMap(
          (group: { objects: { id: string; uuid: string }[] }) => group.objects,
        )
        .find((object: { id: string }) => object.id === id)?.uuid;
      const snapshot = await client.saveWorkspace();
      const signature = Array.from(new Uint8Array(snapshot, 0, 8));
      const size = snapshot.byteLength;
      await runtime.openWorkspaceHdf5(
        "probe.h5",
        new Uint8Array(snapshot),
        true,
      );
      const after = await runtime.getPanelTree("signal");
      const restored = after.groups
        .flatMap(
          (group: { objects: { id: string; uuid: string }[] }) => group.objects,
        )
        .find((object: { uuid: string }) => object.uuid === uuid);
      const restoredValues = await runtime.getSignalData(restored.id);
      return {
        imported,
        x: Array.from(values.x),
        y: Array.from(values.y),
        signature,
        size,
        uuid,
        restoredUuid: restored.uuid,
        restoredY: Array.from(restoredValues.y),
      };
    });
    expect(outcome.imported.files[0].error).toBeUndefined();
    expect(outcome.x).toEqual([0, 1, 2]);
    expect(outcome.y).toEqual([1, 2, 3]);
    expect(outcome.signature).toEqual([137, 72, 68, 70, 13, 10, 26, 10]);
    expect(outcome.size).toBeGreaterThan(1000);
    expect(outcome.uuid).toBeTruthy();
    expect(outcome.restoredUuid).toBe(outcome.uuid);
    expect(outcome.restoredY).toEqual([1, 2, 3]);
  });

  test("workspace opening confirms replacement and imports accompanying files", async ({
    page,
  }) => {
    await page.goto("/remote-host-example.html");
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      {
        timeout: 180_000,
      },
    );
    await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      const client = window.__client;
      await client.addSignal("Saved signal", [0, 1], [1, 2]);
      // @ts-expect-error test-owned value in this isolated page
      window.__workspaceBytes = await client.saveWorkspace();
      await client.addSignal("Unsaved signal", [0, 1], [3, 4]);
    });
    const request = () =>
      page.evaluate(() => {
        // @ts-expect-error test-owned value in this isolated page
        window.__openResult = window.__client.openFiles([
          {
            name: "extra.csv",
            bytes: new TextEncoder().encode("x,y\n0,2\n1,3\n"),
          },
          // @ts-expect-error test-owned value in this isolated page
          { name: "saved.h5", bytes: window.__workspaceBytes },
        ]);
      });
    const result = () =>
      page.evaluate(async () => {
        // @ts-expect-error test-owned value in this isolated page
        return await window.__openResult;
      });
    const iframe = page.frameLocator("#dlw");
    const dialog = iframe
      .getByRole("dialog")
      .filter({ hasText: "Open workspace" });
    await request();
    await expect(dialog).toContainText("Unsaved changes will be lost");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const cancelled = await result();
    expect(cancelled.files[0].error).toContain("Not imported");
    expect(cancelled.files[1].error).toContain("cancelled");
    await expect(iframe.locator(".object-tree-item")).toContainText([
      "Saved signal",
      "Unsaved signal",
    ]);

    await request();
    await dialog.getByRole("button", { name: "Open", exact: true }).click();
    const opened = await result();
    expect(opened.files[0].error).toBeUndefined();
    expect(opened.files[1]).toMatchObject({ workspace: true });
    expect(opened.files[1].error).toBeUndefined();
    await expect(iframe.locator(".object-tree-item")).toContainText([
      "Saved signal",
      "extra",
    ]);
    await expect(
      iframe.locator(".object-tree-item").filter({ hasText: "Unsaved signal" }),
    ).toHaveCount(0);
    await expect(iframe.locator(".app")).toHaveAttribute(
      "data-workspace-reset-state",
      "idle",
    );
  });

  test("external tools process imported data, show results and retain provenance", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/remote-host-example.html");
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      { timeout: 180_000 },
    );
    const outcome = await page.evaluate(async () => {
      // @ts-expect-error injected by the demo page
      const client = window.__client;
      const rows = ["x,y"];
      for (let i = 0; i <= 100; i++) {
        const x = (i - 50) / 10;
        rows.push(`${x},${Math.exp(-0.5 * x * x)}`);
      }
      const imported = await client.openFiles(
        [
          {
            name: "gaussian.csv",
            bytes: new TextEncoder().encode(rows.join("\n")),
          },
        ],
        "signal",
      );
      const id = imported.files[0].ids[0];
      const tools = await client.listTools();
      const schema = await client.callTool("list_available_operations", {
        panel: "signal",
        name: "normalize",
        target_uuid: id,
      });
      const processed = await client.callTool("apply_operation", {
        name: "normalize",
        target_uuid: id,
      });
      const created = processed.data?.created?.[0];
      if (!created) return { imported, tools, schema, processed };
      const analysis = await client.callTool("apply_operation", {
        name: "fwhm",
        target_uuid: created.uuid,
        parameters: { method: "gauss" },
      });
      const results = await client.callTool("get_results", {
        panel: "signal",
        uuids: [created.uuid],
      });
      return { imported, tools, schema, processed, analysis, results, created };
    });
    expect(outcome.imported.files[0].error).toBeUndefined();
    expect(outcome.tools.map((tool: { name: string }) => tool.name)).toContain(
      "apply_operation",
    );
    expect(outcome.schema.ok).toBe(true);
    expect(outcome.processed.ok).toBe(true);
    expect(outcome.created.uuid).toBeTruthy();
    expect(outcome.created.uuid).not.toBe(outcome.created.id);
    expect(outcome.analysis.ok).toBe(true);
    expect(outcome.results.ok).toBe(true);
    expect(outcome.results.data.results[0].results.length).toBeGreaterThan(0);

    const iframe = page.frameLocator("#dlw");
    await expect(
      iframe
        .locator(".object-tree-item")
        .filter({ hasText: outcome.created.title }),
    ).toBeVisible({ timeout: 15_000 });
    await iframe
      .getByRole("tab", { name: "Provenance" })
      .click({ timeout: 15_000 });
    const provenance = iframe.getByTestId("provenance-panel");
    await expect(
      provenance.getByTestId("provenance-activity").first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(provenance).toContainText(/normaliz/i);
  });

  test("the iframe ignores messages from a non-whitelisted origin", async ({
    page,
  }) => {
    // Load the iframe directly with an ``allowedOrigins`` that doesn't
    // match the test's actual origin, then post a request from inside
    // the page (same origin as the iframe → ignored). The SDK request
    // must time out cleanly rather than hang or crash.
    await page.goto(
      "/index.html?allowedOrigins=https://not-this-origin.example.com",
    );
    // Wait for the bridge to be installed (it activates only after the
    // runtime finishes booting). Without this wait, the test would
    // pass for the wrong reason: the ``postMessage`` would be sent
    // before *any* listener exists, masking a hypothetical
    // origin-check regression.
    await waitForRuntimeReady(page);
    const dropped = await page.evaluate(async () => {
      return await new Promise<boolean>((resolve) => {
        let answered = false;
        const onMessage = (e: MessageEvent) => {
          const data = e.data as { type?: string } | null;
          if (data && data.type === "response") {
            answered = true;
          }
        };
        window.addEventListener("message", onMessage);
        // Posting to ourselves: the bridge listens on the same window.
        // ``event.origin`` will be this page's origin, which is NOT in
        // the iframe's whitelist — the request must be dropped silently.
        window.postMessage(
          { id: 1, type: "request", method: "get_version" },
          "*",
        );
        setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve(!answered);
        }, 800);
      });
    });
    expect(dropped).toBe(true);
  });

  test("can push and read back a 50k-sample signal in binary mode", async ({
    page,
  }) => {
    // Smoke-test for the binary fast path: ``Float64Array`` →
    // ``np.frombuffer`` on push, ``encoding="bytes"`` → typed array
    // on read.  50 k samples (400 kB per array) is large enough that
    // the legacy boxed/JSON path would be obviously slower (multiple
    // seconds vs sub-second), so the perf budget below would catch
    // any regression that re-introduced ``Array.from`` boxing.
    //
    // We don't need a separate big-image E2E: the same coercion code
    // path (``_coerce_array`` + flat-buffer reshape) is exercised by
    // the Python ``test_binary_transfer.py`` and SDK Vitest suites,
    // and the live image read path is already covered by
    // ``image_perf.spec.ts``.
    //
    // This is a *perf budget* probe rather than a correctness
    // invariant — the same coercion code path is already covered by
    // the Python ``test_binary_transfer.py`` and the SDK Vitest
    // suites — so it is opt-in via the ``PERF`` env var to keep the
    // default CI run cheap.
    test.skip(
      !process.env.PERF,
      "Perf budget probe — opt-in via PERF=1 npm run test:e2e",
    );
    await page.goto("/remote-host-example.html");
    await expect(page.locator("body")).toHaveAttribute(
      "data-remote-ready",
      "1",
      { timeout: 180_000 },
    );

    const N = 50_000;
    const probes = await page.evaluate(async (n) => {
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = i * 1e-3;
        ys[i] = Math.sin(2 * Math.PI * xs[i]) * 0.5;
      }
      const t0 = performance.now();
      // @ts-expect-error injected by the demo page
      const id = await window.__client.addSignal("Big", xs, ys);
      const tPush = performance.now() - t0;
      const t1 = performance.now();
      // @ts-expect-error see above
      const data = await window.__client.getSignalXY(id);
      const tPull = performance.now() - t1;
      // Sample a handful of points instead of shipping every float
      // back through Playwright's serialiser.
      const probeIdx = [0, 1, 100, 12_345, n - 2, n - 1];
      const xv = data.x as Float64Array;
      const yv = data.y as Float64Array;
      return {
        id,
        size: xv.length,
        x_is_typed: xv instanceof Float64Array,
        y_is_typed: yv instanceof Float64Array,
        sampled_x: probeIdx.map((i) => xv[i]),
        sampled_y: probeIdx.map((i) => yv[i]),
        expected_x: probeIdx.map((i) => i * 1e-3),
        expected_y: probeIdx.map((i) => Math.sin(2 * Math.PI * i * 1e-3) * 0.5),
        push_ms: tPush,
        pull_ms: tPull,
      };
    }, N);

    expect(probes.size).toBe(N);
    expect(probes.x_is_typed).toBe(true);
    expect(probes.y_is_typed).toBe(true);
    // X is exactly representable (i*1e-3 round-trips bit-perfectly
    // through float64), but Y goes through sin() — JS's
    // ``Math.sin`` and numpy's may differ by ~1 ULP for large
    // indices, so we compare with float-aware tolerance.
    for (let i = 0; i < probes.sampled_x.length; i++) {
      expect(probes.sampled_x[i]).toBeCloseTo(probes.expected_x[i], 12);
      expect(probes.sampled_y[i]).toBeCloseTo(probes.expected_y[i], 12);
    }
    // Soft perf budget: the binary path should round-trip 50 k
    // samples well within 15 s on CI (the legacy boxed/JSON path
    // would take noticeably longer, so a regression here would fire).
    expect(probes.push_ms).toBeLessThan(15_000);
    expect(probes.pull_ms).toBeLessThan(15_000);
  });
});
