import { describe, it, expect, beforeEach } from "vitest";
import {
  hashSource,
  isPluginTrusted,
  trustPlugin,
  listTrustedPlugins,
  revokePluginTrust,
} from "../../../src/plugins/trustStore";

beforeEach(() => {
  window.localStorage.clear();
});

describe("trustStore", () => {
  it("hashes consistent source strings to the same SHA-256 digest", async () => {
    const a = await hashSource("hello world");
    const b = await hashSource("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes different strings to different digests", async () => {
    const a = await hashSource("a");
    const b = await hashSource("b");
    expect(a).not.toBe(b);
  });

  it("treats unknown plugins as untrusted", async () => {
    expect(await isPluginTrusted("foo.py", "print('x')")).toBe(false);
    expect(listTrustedPlugins()).toEqual([]);
  });

  it("persists trust decisions and reports them back", async () => {
    const src = "import sigima\n";
    await trustPlugin("plugin.py", src);
    expect(await isPluginTrusted("plugin.py", src)).toBe(true);
    const entries = listTrustedPlugins();
    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toBe("plugin.py");
  });

  it("invalidates trust when the source changes", async () => {
    await trustPlugin("p.py", "v1");
    expect(await isPluginTrusted("p.py", "v2")).toBe(false);
  });

  it("revokes trust by filename + hash", async () => {
    const src = "code";
    await trustPlugin("p.py", src);
    const hash = await hashSource(src);
    revokePluginTrust("p.py", hash);
    expect(await isPluginTrusted("p.py", src)).toBe(false);
    expect(listTrustedPlugins()).toEqual([]);
  });

  it("does not duplicate entries when re-trusting the same source", async () => {
    await trustPlugin("p.py", "x");
    await trustPlugin("p.py", "x");
    expect(listTrustedPlugins()).toHaveLength(1);
  });

  it("returns an empty list when localStorage is corrupt", () => {
    window.localStorage.setItem(
      "datalab-web/trusted-plugins",
      "not-valid-json{",
    );
    expect(listTrustedPlugins()).toEqual([]);
  });
});
