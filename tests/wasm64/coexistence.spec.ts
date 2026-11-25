import { expect, test, type Page } from "@playwright/test";

// Install explicit records and check contents, not just directory names.
async function sentinel(page: Page, prefix: string, write: boolean) {
  return page.evaluate(
    async ({ prefix, write }) => {
      const key = prefix + "datalab-web/trusted-plugins";
      const token = prefix + "datalab-web.capsuleRegistry.token";
      const dbName = prefix + "datalab-web.recent";
      const cacheName = prefix + "pyjs-packages-v2";
      const directory = prefix + "dlw-plugin-wheels";
      const root = await navigator.storage.getDirectory();
      if (write) {
        localStorage.setItem(
          key,
          JSON.stringify([{ filename: "witness.py", hash: "witness" }]),
        );
        sessionStorage.setItem(token, "token-witness");
        const cache = await caches.open(cacheName);
        await cache.put("/witness", new Response("cache-witness"));
        const dir = await root.getDirectoryHandle(directory, { create: true });
        const file = await dir.getFileHandle("witness", { create: true });
        const out = await file.createWritable();
        await out.write("plugin-witness");
        await out.close();
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const entries = request.result.createObjectStore("entries", {
            keyPath: ["kind", "id"],
          });
          entries.createIndex("by-kind-lastSeen", ["kind", "lastSeen"]);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      let recent: string | undefined;
      try {
        const tx = db.transaction("entries", write ? "readwrite" : "readonly");
        const store = tx.objectStore("entries");
        if (write)
          store.put({
            kind: "macro",
            id: "witness",
            title: "Witness",
            content: "idb-witness",
            lastSeen: 1,
          });
        const read = store.get(["macro", "witness"]);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        recent = read.result?.content;
      } finally {
        db.close();
      }
      const dir = await root.getDirectoryHandle(directory);
      const file = await (await dir.getFileHandle("witness")).getFile();
      return [
        localStorage.getItem(key),
        sessionStorage.getItem(token),
        recent,
        await (await (await caches.open(cacheName)).match("/witness"))?.text(),
        await file.text(),
      ];
    },
    { prefix, write },
  );
}

test("the demo cannot inherit or erase stable state on the same origin", async ({
  context,
  page,
  baseURL,
}) => {
  // Storage is independent of scientific boot. Keep this test inexpensive
  // and offline; worker startup/ready is exercised by workspace.spec.ts.
  const fullBuilds = Boolean(process.env.DLW_COEXISTENCE_ORIGIN);
  if (fullBuilds) test.setTimeout(480_000);
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));
  async function openApp(path: string) {
    requests.length = 0;
    const start = Date.now();
    await page.goto(path);
    if (fullBuilds) {
      const app = page.locator(".app");
      await expect(app).toHaveAttribute(
        "data-runtime-status",
        /^(ready|error)$/,
        { timeout: 240_000 },
      );
      expect(
        await app.getAttribute("data-runtime-status"),
        await app.innerText(),
      ).toBe("ready");
      const wasm = path === "/web-wasm64/";
      await expect(app).toHaveAttribute(
        "data-engine",
        wasm ? "wasm64" : "pyodide",
      );
      const kernel = page
        .workers()
        .some((w) => /\/kernelWorker-[^/]+\.js$/.test(w.url()));
      expect(kernel).toBe(!path.includes("runtime=main"));
      const experimental = requests.filter((url) =>
        /\/(?:pyjs|conda|archives)\/|\/environment\.json(?:$|\?)|wasmBackend-/.test(
          url,
        ),
      );
      if (wasm)
        expect(
          experimental.some((url) => url.endsWith("/environment.json")),
        ).toBe(true);
      else expect(experimental).toEqual([]);
      console.log(
        `${path}: ready ${Date.now() - start} ms; kernelWorker=${kernel}; WASM64 requests=${experimental.length}`,
      );
      expect(await page.evaluate(() => "runtime" in window)).toBe(false);
    }
  }
  if (!fullBuilds)
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin !== baseURL ||
      /\/environment\.json$/.test(route.request().url())
        ? route.abort()
        : route.continue(),
    );
  await openApp("/web/");
  await page.locator(".menubar-theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const stable = await sentinel(page, "", true);
  expect(stable.slice(1)).toEqual([
    "token-witness",
    "idb-witness",
    "cache-witness",
    "plugin-witness",
  ]);
  await page.evaluate(() => localStorage.setItem("datalab-web:lang", "fr"));
  await openApp("/web-wasm64/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".menubar-ai-toggle")).toHaveCount(0);
  await page.locator(".menubar-theme-toggle").click();
  const prefix = "dlw-wasm64-demo.";
  expect(
    await page.evaluate(
      (p) => localStorage.getItem(p + "datalab-web:theme"),
      prefix,
    ),
  ).toBe("dark");
  await sentinel(page, prefix, true);
  await openApp("/web-wasm64/?engine=pyodide");
  await expect(page.locator(".menubar-ai-toggle")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/web-wasm64/?reset-demo-storage=1");
  const clear = page.getByRole("button", { name: "Clear demo storage" });
  await expect(clear).toBeVisible();
  expect(await sentinel(page, prefix, false)).toEqual(stable);
  await clear.click();
  await expect(page.getByRole("status")).toHaveText("Demo storage cleared.");
  expect(
    await page.evaluate(async (p) => {
      const root = await navigator.storage.getDirectory();
      let opfsPresent = true;
      try {
        await root.getDirectoryHandle(p + "dlw-plugin-wheels");
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
        opfsPresent = false;
      }
      return [
        ...Object.keys(localStorage).filter((n) => n.startsWith(p)),
        ...Object.keys(sessionStorage).filter((n) => n.startsWith(p)),
        ...(await indexedDB.databases()).filter(({ name }) =>
          name?.startsWith(p),
        ),
        ...(await caches.keys()).filter((n) => n.startsWith(p)),
        ...(opfsPresent ? ["OPFS"] : []),
      ];
    }, prefix),
  ).toEqual([]);
  await openApp("/web/?reset-demo-storage=1&engine=pyodide&runtime=main");
  await expect(page.locator(".menubar-ai-toggle")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await sentinel(page, "", false)).toEqual(stable);
});
