/**
 * Unit tests for ``remoteBridge.ts`` — the iframe-side RPC handler that
 * exposes the proxyBridge whitelist to a host page via ``postMessage``.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateRemoteBridge,
  collectTransferables,
  parseAllowedOrigins,
  REMOTE_MODEL_CHANGED_EVENT,
} from "../../src/runtime/remoteBridge";
import type { DataLabRuntime } from "../../src/runtime/runtime";

// Minimal runtime stub: only the surface that ``buildProxyBridge``
// actually touches in the methods exercised by these tests.
function makeRuntimeStub(): DataLabRuntime {
  const runtime: Partial<DataLabRuntime> = {
    addSignalFromArrays: vi.fn(async () => "sig-id-1"),
    addImageFromArray: vi.fn(async () => "img-id-1"),
    listSignals: vi.fn(async () => [
      { id: "sig-id-1", title: "Sine", size: 256 },
    ]),
    listFeatures: vi.fn(async () => [
      { id: "fft", label: "FFT", has_params: false },
    ]),
    applyFeature: vi.fn(async () => ["sig-id-2"]),
    getSignalData: vi.fn(async () => ({
      id: "sig-id-1",
      title: "Sine",
      size: 3,
      x: [0, 1, 2],
      y: [0, 1, 0],
      xlabel: "",
      ylabel: "",
      xunit: "",
      yunit: "",
      uuid: null,
    })),
  };
  return runtime as DataLabRuntime;
}

// jsdom's ``MessageEvent`` constructor is fine, but ``window.postMessage``
// is async via the event loop; we drive it manually with synthetic events
// that we dispatch on ``window``. The bridge's response goes through the
// captured peer's ``postMessage`` mock.
interface MockPeer {
  postMessage: ReturnType<typeof vi.fn>;
}

function fakeMessageEvent(opts: {
  origin: string;
  source: MockPeer;
  data: unknown;
}): MessageEvent {
  return new MessageEvent("message", {
    origin: opts.origin,
    source: opts.source as unknown as MessageEventSource,
    data: opts.data,
  });
}

describe("parseAllowedOrigins", () => {
  it("returns [] when missing or empty", () => {
    expect(parseAllowedOrigins(null)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
    expect(parseAllowedOrigins("?foo=bar")).toEqual([]);
    expect(parseAllowedOrigins("?allowedOrigins=")).toEqual([]);
  });

  it("splits CSV values and trims whitespace", () => {
    expect(
      parseAllowedOrigins(
        "?allowedOrigins=https://a.example.com, http://b.test:8080",
      ),
    ).toEqual(["https://a.example.com", "http://b.test:8080"]);
  });

  it("preserves the wildcard", () => {
    expect(parseAllowedOrigins("?allowedOrigins=*")).toEqual(["*"]);
  });
});

describe("collectTransferables", () => {
  it("finds buffers nested in arrays and objects", () => {
    const a = new Float64Array([1, 2, 3]);
    const b = new Float32Array([4, 5]);
    const value = { x: a, nested: { items: [b, "ignored", 42] } };
    const buffers = collectTransferables(value);
    expect(buffers).toContain(a.buffer);
    expect(buffers).toContain(b.buffer);
    expect(buffers).toHaveLength(2);
  });

  it("returns [] for plain primitives", () => {
    expect(collectTransferables(null)).toEqual([]);
    expect(collectTransferables("hello")).toEqual([]);
    expect(collectTransferables(42)).toEqual([]);
  });
});

describe("activateRemoteBridge", () => {
  let win: Window & typeof globalThis;
  let runtime: DataLabRuntime;

  beforeEach(() => {
    win = window as Window & typeof globalThis;
    runtime = makeRuntimeStub();
  });

  afterEach(() => {
    // Just in case a test forgets to dispose.
    vi.restoreAllMocks();
  });

  it("returns null when no allowedOrigins is configured", () => {
    const handle = activateRemoteBridge(runtime, {
      allowedOriginsSource: "",
      win,
    });
    expect(handle).toBeNull();
  });

  it("ignores messages whose origin is not whitelisted", async () => {
    const handle = activateRemoteBridge(runtime, {
      allowedOriginsSource: "?allowedOrigins=https://allowed.example.com",
      win,
    });
    expect(handle).not.toBeNull();
    const peer: MockPeer = { postMessage: vi.fn() };

    win.dispatchEvent(
      fakeMessageEvent({
        origin: "https://evil.example.com",
        source: peer,
        data: { id: 1, type: "request", method: "get_version" },
      }),
    );

    // Give the handler a microtask to run; it should not respond.
    await Promise.resolve();
    await Promise.resolve();
    expect(peer.postMessage).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it("dispatches to a whitelisted method and returns the result", async () => {
    const handle = activateRemoteBridge(runtime, {
      allowedOriginsSource: "?allowedOrigins=*",
      win,
      version: "1.2.3",
    });
    const peer: MockPeer = { postMessage: vi.fn() };

    win.dispatchEvent(
      fakeMessageEvent({
        origin: "https://anything.test",
        source: peer,
        data: { id: 7, type: "request", method: "get_version" },
      }),
    );
    // Allow the awaited bridge method to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(peer.postMessage).toHaveBeenCalledTimes(1);
    const [response] = peer.postMessage.mock.calls[0];
    expect(response).toMatchObject({
      id: 7,
      type: "response",
      result: "1.2.3",
    });
    handle?.dispose();
  });

  it("returns an error response for unknown methods", async () => {
    const handle = activateRemoteBridge(runtime, {
      allowedOriginsSource: "?allowedOrigins=*",
      win,
    });
    const peer: MockPeer = { postMessage: vi.fn() };

    win.dispatchEvent(
      fakeMessageEvent({
        origin: "https://anything.test",
        source: peer,
        data: { id: 1, type: "request", method: "definitely_not_a_method" },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(peer.postMessage).toHaveBeenCalledTimes(1);
    const [response] = peer.postMessage.mock.calls[0];
    expect(response).toMatchObject({
      id: 1,
      type: "response",
      error: { code: "unknown_method" },
    });
    handle?.dispose();
  });

  it("wraps thrown errors into an error response", async () => {
    const broken = makeRuntimeStub();
    (broken.addSignalFromArrays as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    const handle = activateRemoteBridge(broken, {
      allowedOriginsSource: "?allowedOrigins=*",
      win,
    });
    const peer: MockPeer = { postMessage: vi.fn() };

    win.dispatchEvent(
      fakeMessageEvent({
        origin: "https://anything.test",
        source: peer,
        data: {
          id: 2,
          type: "request",
          method: "add_signal",
          params: { title: "X", xdata: [0], ydata: [0] },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    const [response] = peer.postMessage.mock.calls[0];
    expect(response).toMatchObject({
      id: 2,
      type: "response",
      error: { code: "method_error", message: "boom" },
    });
    handle?.dispose();
  });

  it("dispose() removes the listener", async () => {
    const handle = activateRemoteBridge(runtime, {
      allowedOriginsSource: "?allowedOrigins=*",
      win,
    });
    handle?.dispose();
    const peer: MockPeer = { postMessage: vi.fn() };

    win.dispatchEvent(
      fakeMessageEvent({
        origin: "https://anything.test",
        source: peer,
        data: { id: 3, type: "request", method: "get_version" },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(peer.postMessage).not.toHaveBeenCalled();
  });

  it("notifies the UI and the host on model mutations", async () => {
    const handle = activateRemoteBridge(runtime, {
      allowedOriginsSource: "?allowedOrigins=*",
      win,
    });
    const peer: MockPeer = { postMessage: vi.fn() };
    const customEvents: { panel: string | null }[] = [];
    const onCustom = (e: Event) => {
      customEvents.push((e as CustomEvent<{ panel: string | null }>).detail);
    };
    win.addEventListener(REMOTE_MODEL_CHANGED_EVENT, onCustom);

    win.dispatchEvent(
      fakeMessageEvent({
        origin: "https://anything.test",
        source: peer,
        data: {
          id: 9,
          type: "request",
          method: "add_signal",
          params: { title: "Probe", xdata: [0, 1], ydata: [0, 1] },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    // CustomEvent fired on window for App.tsx to refresh.
    expect(customEvents).toEqual([{ panel: "signal" }]);

    // The peer received both the response AND a ``model-changed`` event.
    const messages = peer.postMessage.mock.calls.map((c) => c[0]);
    expect(messages).toContainEqual(
      expect.objectContaining({ id: 9, type: "response", result: "sig-id-1" }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "event",
        name: "model-changed",
        payload: { panel: "signal" },
      }),
    );

    win.removeEventListener(REMOTE_MODEL_CHANGED_EVENT, onCustom);
    handle?.dispose();
  });
});
