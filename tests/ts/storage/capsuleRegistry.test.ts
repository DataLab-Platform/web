/**
 * Tests for the optional capsule registry client (``capsuleRegistry``).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RegistryClient,
  loadRegistrySettings,
  registryBase,
  saveRegistrySettings,
  sha256Hex,
} from "../../../src/storage/capsuleRegistry";

const FP = `sha256:${"a".repeat(64)}`;

function respond(body: BodyInit | null, init: ResponseInit = {}) {
  return vi.fn(async () => new Response(body, init));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("registry settings", () => {
  it("accepts only absolute http(s) addresses", () => {
    expect(registryBase("https://reg.example/x/")).toBe(
      "https://reg.example/x",
    );
    expect(() => registryBase("javascript:alert(1)")).toThrow();
    expect(() => registryBase("reg.example")).toThrow();
  });

  it("keeps the token for the session only", () => {
    saveRegistrySettings({ address: "https://reg.example", token: "secret" });
    expect(localStorage.getItem("datalab-web.capsuleRegistry.token")).toBe(
      null,
    );
    expect(loadRegistrySettings()).toEqual({
      address: "https://reg.example",
      token: "secret",
    });
    saveRegistrySettings({ address: "", token: "" });
    expect(loadRegistrySettings()).toEqual({ address: "", token: "" });
  });
});

describe("RegistryClient", () => {
  it("sends the token on writes only", async () => {
    const fetch = respond(JSON.stringify({ fingerprint: FP, created: true }), {
      status: 201,
    });
    vi.stubGlobal("fetch", fetch);
    const client = new RegistryClient("https://reg.example", "secret");
    await client.publishManifest("{}");
    await client.listRevisions().catch(() => undefined);
    const [writeUrl, write] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const [, read] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(writeUrl).toBe("https://reg.example/api/v1/revisions");
    expect(new Headers(write.headers).get("Authorization")).toBe(
      "Bearer secret",
    );
    expect(new Headers(read.headers).get("Authorization")).toBe(null);
  });

  it("reports the registry's reason", async () => {
    vi.stubGlobal(
      "fetch",
      respond(JSON.stringify({ detail: "Unknown revision" }), { status: 404 }),
    );
    await expect(
      new RegistryClient("https://reg.example").getManifestText(FP),
    ).rejects.toThrow("Registry error 404: Unknown revision");
  });

  it("refuses an attachment that does not match the manifest", async () => {
    const data = new TextEncoder().encode("protocol");
    const expected = await sha256Hex(data);
    vi.stubGlobal("fetch", respond(data.slice()));
    const client = new RegistryClient("https://reg.example");
    expect(
      Array.from(await client.getAttachment(FP, "p.txt", expected)),
    ).toEqual(Array.from(data));
    vi.stubGlobal("fetch", respond(new TextEncoder().encode("other")));
    await expect(client.getAttachment(FP, "p.txt", expected)).rejects.toThrow(
      "does not match the manifest",
    );
  });
});
