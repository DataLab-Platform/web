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
    await expect(iframe.locator(".object-tree-item")).toContainText(
      "Probe",
      { timeout: 5_000 },
    );

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
});
