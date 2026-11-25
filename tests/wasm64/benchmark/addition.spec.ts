import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { freemem, release, totalmem } from "node:os";
import { join } from "node:path";
import type { TransferEvent } from "../../../src/runtime/benchmarkTransfer";

interface Diagnostics {
  heapBytes: number;
  dataBytes: number;
  transfers: TransferEvent[];
  oracle: {
    ids: string[];
    nbytes: string;
    operation: string;
    timings: { compute: [string, string] };
  };
}
async function diagnostics(page: Page, verify = false): Promise<Diagnostics> {
  await page
    .getByRole("button", {
      name: verify ? "Check addition" : "Read diagnostics",
      exact: true,
    })
    .click();
  const output = page.getByTestId("qualification-report");
  await expect(output).toHaveText(/"heapBytes"|"error"/, {
    timeout: 10 * 60_000,
  });
  const result = JSON.parse((await output.textContent()) ?? "{}");
  if (result.error) throw Error(result.error);
  return result;
}

test("fixed workspace pair → Operations / Sum → bounded oracle", async ({
  browser,
  page,
  context,
}, info) => {
  const tier = process.env.DLW_B_TIER ?? "";
  const n = tier === "smoke" ? 577 : Number(tier);
  const output = process.env.DLW_B_OUTPUT;
  const siteSha256 = process.env.DLW_B_SITE_SHA;
  if (
    process.env.CI ||
    !output ||
    !/^[a-f0-9]{64}$/.test(siteSha256 ?? "") ||
    !["smoke", "2048", "8192", "18432"].includes(tier) ||
    process.env.DLW_B_CONSENT !==
      (tier === "smoke" ? "--small-only" : `--dedicated=${tier}`) ||
    info.config.workers !== 1 ||
    info.project.retries ||
    info.project.repeatEach !== 1
  )
    throw Error("Refusing unconfirmed or repeated run; use run.mjs.");
  const report: Record<string, unknown> = {
    passed: false,
    tier,
    siteSha256,
    browser: browser.version(),
    os: release(),
    totalRAM: totalmem(),
    freeAtLaunch: freemem(),
    processLimit: process.env.DLW_PROCESS_LIMIT_NOTE,
  };
  const persist = () =>
    writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  let sampler: ChildProcess | undefined;
  const refused: string[] = [];
  const start = Date.now();
  try {
    await context.route(/^https?:/, (route) => {
      if (new URL(route.request().url()).origin !== "http://127.0.0.1:49149") {
        refused.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto("./");
    const app = page.locator(".app");
    await expect(app).toHaveAttribute(
      "data-runtime-status",
      /^(ready|error)$/,
      { timeout: 240_000 },
    );
    if ((await app.getAttribute("data-runtime-status")) === "error")
      throw Error(await app.innerText());
    await expect(page.locator(".app")).toHaveAttribute("data-engine", "wasm64");
    expect(await page.evaluate(() => "runtime" in window)).toBe(false);
    report.bootMs = Date.now() - start;
    report.ready = await diagnostics(page);
    if (process.platform === "win32") {
      const cdp = await browser.newBrowserCDPSession();
      const ids = (await cdp.send("SystemInfo.getProcessInfo")).processInfo
        .filter((p) => p.type.toLowerCase() === "renderer")
        .map((p) => p.id);
      expect(ids.length).toBeGreaterThan(0);
      const csv = join(output, "renderer.csv");
      sampler = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          "tests/wasm64/benchmark/sample.ps1",
          "-RendererIds",
          ids.join(","),
          "-OutputFile",
          csv,
        ],
        { stdio: "inherit" },
      );
      await expect
        .poll(
          () =>
            existsSync(csv) &&
            readFileSync(csv, "utf8").split("\n").length >= 3,
          { timeout: 15_000 },
        )
        .toBe(true);
      const host = JSON.parse(readFileSync(`${csv}.host`, "utf8"));
      report.host = host;
      const reserve =
        { smoke: 0, 2048: 2, 8192: 6, 18432: 16 }[
          tier as "smoke" | "2048" | "8192" | "18432"
        ] *
        2 ** 30;
      expect(
        Math.min(host.available, host.commitLimit - host.committed),
      ).toBeGreaterThanOrEqual(reserve);
    }
    persist();
    await page.getByLabel("Fixed tier").selectOption(tier);
    await page.getByLabel("Tier confirmation").fill(`DEDICATED:${tier}`);
    const generateStart = Date.now();
    await page.getByRole("button", { name: "Generate pair" }).click();
    await expect(page.getByTestId("qualification-report")).toHaveText(
      /"ids"|"error"/,
      { timeout: 5 * 60_000 },
    );
    const generated = JSON.parse(
      (await page.getByTestId("qualification-report").textContent()) ?? "{}",
    );
    if (generated.error) throw Error(generated.error);
    const tree = page.locator(".object-tree-item");
    const preview = page.getByTestId("bounded-preview");
    await expect(preview).toHaveCount(1, { timeout: 5 * 60_000 });
    await expect(tree).toHaveCount(2);
    const ids = generated.ids as string[];
    await expect(preview).toHaveAttribute("data-oid", ids[0]);
    report.firstRenderMs = Date.now() - generateStart;
    await page.getByRole("tab", { name: "Properties", exact: true }).click();
    await expect(
      page.getByText("Not calculated", { exact: true }).first(),
    ).toBeVisible();
    const one = await diagnostics(page);
    expect(one.dataBytes).toBe(8 * n * n);
    await tree
      .filter({ hasText: "WASM64 B" })
      .click({ modifiers: ["Control"] });
    await expect(preview).toHaveCount(2);
    const two = await diagnostics(page);
    report.single = one;
    report.multi = two;
    persist();
    await page.evaluate(() => {
      Object.assign(window, { qualificationTicks: [] as number[] });
      const ticks = (window as unknown as { qualificationTicks: number[] })
        .qualificationTicks;
      // Keep a bounded trace; the worker timestamps the actual computation.
      const timer = setInterval(() => {
        if (ticks.length < 100000) ticks.push(Date.now());
        else clearInterval(timer);
      }, 10);
    });
    const clicked = Date.now();
    await page
      .getByRole("menuitem", { name: "Operations", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Sum", exact: true }).click();
    await expect(tree).toHaveCount(3, { timeout: 15 * 60_000 });
    await expect(preview).toHaveCount(1, { timeout: 5 * 60_000 });
    const display = await diagnostics(page);
    report.resultRenderMs = Date.now() - clicked;
    const checked = await diagnostics(page, true);
    report.checked = checked;
    await expect(preview).toHaveAttribute("data-oid", checked.oracle.ids[2]);
    await expect(preview).toContainText(`${n} × ${n} float64`);
    await expect(preview).toContainText("512 × 512 float32");
    await expect(page.locator(".multi-image-canvas")).toBeVisible();
    expect(checked.dataBytes).toBe(16 * n * n);
    expect(checked.dataBytes).toBe(Number(checked.oracle.nbytes));
    expect(checked.oracle.operation).toBe("sigima.image.addition");
    const [begin, end] = checked.oracle.timings.compute.map((ms) => {
      expect(ms).toMatch(/^\d{13}$/);
      return Number(ms);
    });
    expect(begin).toBeGreaterThanOrEqual(clicked);
    expect(end).toBeGreaterThanOrEqual(begin);
    expect(end).toBeLessThanOrEqual(Date.now());
    const marker = await page.evaluate(
      ([a, b]) =>
        (
          window as unknown as { qualificationTicks: number[] }
        ).qualificationTicks.find((t) => t > a && t < b),
      [begin, end],
    );
    report.uiTickDuringCompute = marker ?? null;
    if (tier === "18432") {
      expect(checked.heapBytes).toBeGreaterThan(2 ** 32);
      expect(checked.dataBytes).toBeGreaterThan(2 ** 32);
      expect(marker).toBeDefined();
    }
    const events = [
      one.transfers,
      two.transfers.slice(one.transfers.length),
      display.transfers.slice(two.transfers.length),
    ];
    report.interactions = events.map((stage, i) =>
      ["python", "worker"].map((boundary) => {
        const payloads = stage
          .filter((e) => e.boundary === boundary)
          .map((e) => e.backing);
        const max = Math.max(0, ...payloads),
          sum = payloads.reduce((a, b) => a + b, 0);
        expect(max).toBe((i === 1 ? 2 : 1) * 512 * 512 * 4);
        expect(sum).toBe(max);
        return { boundary, max, sum };
      }),
    );
    expect(refused).toEqual([]);
    if (sampler) {
      expect(sampler.exitCode).toBeNull();
      const csv = readFileSync(join(output, "renderer.csv"), "utf8")
        .trim()
        .split(/\r?\n/)
        .slice(1);
      const lastAt = Number(csv.at(-1)?.split(",")[0]);
      expect(Date.now() - lastAt).toBeLessThan(5000);
      report.maxObservedRendererWorkingSet = Math.max(
        ...csv.map((row) => Number(row.split(",")[2])),
      );
    }
    report.passed = true;
  } catch (err) {
    report.error = String(err);
    throw err;
  } finally {
    sampler?.kill();
    report.elapsedMs = Date.now() - start;
    report.blockedRequests = refused;
    persist();
  }
});
