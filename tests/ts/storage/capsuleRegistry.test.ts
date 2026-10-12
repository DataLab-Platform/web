/**
 * Tests for the optional capsule registry client (``capsuleRegistry``).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REGISTRY_LIMITS,
  RegistryClient,
  loadRegistrySettings,
  readLimited,
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
      Array.from(
        await client.getAttachment(FP, "p.txt", expected, data.length),
      ),
    ).toEqual(Array.from(data));
    vi.stubGlobal("fetch", respond(new TextEncoder().encode("other")));
    await expect(
      client.getAttachment(FP, "p.txt", expected, data.length),
    ).rejects.toThrow("does not match the manifest");
    vi.stubGlobal("fetch", respond(data.slice(0, 4)));
    await expect(
      client.getAttachment(FP, "p.txt", expected, data.length),
    ).rejects.toThrow("does not match the manifest");
  });
});

/** A body streamed in chunks, recording whether the reader cancelled it. */
function streamed(chunks: number, chunkSize: number) {
  const state = { sent: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.sent === chunks) return controller.close();
      state.sent += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(32));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { body, state };
}

describe("registry response limits", () => {
  it("reads a body up to its limit", async () => {
    const data = await readLimited(new Response("x".repeat(10)), 10);
    expect(data.byteLength).toBe(10);
  });

  it("refuses an announced size over the limit without reading", async () => {
    const { body, state } = streamed(4, 8);
    const response = new Response(body, {
      headers: { "Content-Length": "32" },
    });
    await expect(readLimited(response, 31)).rejects.toThrow(
      "The registry response exceeds 31 bytes",
    );
    expect(state.sent).toBeLessThanOrEqual(1);
    expect(state.cancelled).toBe(true);
  });

  it("stops reading a stream as soon as it exceeds the limit", async () => {
    const { body, state } = streamed(1000, 1024);
    await expect(readLimited(new Response(body), 4096)).rejects.toThrow(
      "exceeds 4096 bytes",
    );
    expect(state.sent).toBeLessThan(10);
    expect(state.cancelled).toBe(true);
  });

  it("refuses an invalid limit", async () => {
    await expect(readLimited(new Response("x"), Number.NaN)).rejects.toThrow(
      RangeError,
    );
  });

  it("bounds listings, manifests and attachments", async () => {
    const client = new RegistryClient("https://reg.example");
    const huge = (size: number) =>
      vi.fn(async () => new Response(streamed(size / 65_536 + 1, 65_536).body));
    vi.stubGlobal("fetch", huge(REGISTRY_LIMITS.listing));
    await expect(client.listRevisions()).rejects.toThrow("exceeds");
    await expect(client.listReviewTexts(FP)).rejects.toThrow("exceeds");
    vi.stubGlobal("fetch", huge(REGISTRY_LIMITS.manifest));
    await expect(client.getManifestText(FP)).rejects.toThrow("exceeds");
    vi.stubGlobal("fetch", respond("y".repeat(101)));
    await expect(
      client.getAttachment(FP, "p.txt", "0".repeat(64), 100),
    ).rejects.toThrow("exceeds 100 bytes");
  });

  it("keeps the status text when an error body is too large", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(streamed(2, REGISTRY_LIMITS.reply).body, {
            status: 500,
            statusText: "Server Error",
          }),
      ),
    );
    await expect(
      new RegistryClient("https://reg.example").listRevisions(),
    ).rejects.toThrow("Registry error 500: Server Error");
  });
});
