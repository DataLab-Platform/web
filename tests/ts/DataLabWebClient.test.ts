/**
 * Unit tests for the host-side ``DataLabWebClient`` SDK.
 *
 * The SDK talks to a DataLab-Web iframe over ``window.postMessage``.
 * These tests stub the iframe with a fake ``contentWindow`` that
 * captures outgoing messages and synthesises responses, so we can
 * verify the request → response correlation logic without booting
 * Pyodide.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataLabWebClient,
  DataLabWebRemoteError,
} from "../../src/sdk/DataLabWebClient";

interface FakeIframe {
  contentWindow: { postMessage: ReturnType<typeof vi.fn> };
}

function makeFakeIframe(): FakeIframe {
  return {
    contentWindow: { postMessage: vi.fn() },
  };
}

/** Replay a server response by dispatching a ``message`` event with the
 *  fake iframe as ``source``. */
function reply(iframe: FakeIframe, data: unknown): void {
  const event = new MessageEvent("message", {
    data,
    source: iframe.contentWindow as unknown as MessageEventSource,
    origin: "http://iframe.test",
  });
  window.dispatchEvent(event);
}

describe("DataLabWebClient", () => {
  let iframe: FakeIframe;
  let client: DataLabWebClient;

  beforeEach(() => {
    iframe = makeFakeIframe();
    client = new DataLabWebClient(iframe as unknown as HTMLIFrameElement, {
      targetOrigin: "http://iframe.test",
    });
  });

  afterEach(() => {
    client.dispose();
  });

  it("posts a request with auto-incremented id and resolves on response", async () => {
    const promise = client.getVersion();
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    const [request, origin] = iframe.contentWindow.postMessage.mock.calls[0];
    expect(origin).toBe("http://iframe.test");
    expect(request).toMatchObject({
      type: "request",
      method: "get_version",
    });
    const id = (request as { id: number }).id;

    reply(iframe, { id, type: "response", result: "9.9.9" });
    await expect(promise).resolves.toBe("9.9.9");
  });

  it("rejects with DataLabWebRemoteError when the response carries an error", async () => {
    const promise = client.call("nope");
    const id = (
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: number }
    ).id;
    reply(iframe, {
      id,
      type: "response",
      error: { code: "unknown_method", message: "Unknown method: nope" },
    });
    await expect(promise).rejects.toBeInstanceOf(DataLabWebRemoteError);
    await expect(promise).rejects.toMatchObject({ code: "unknown_method" });
  });

  it("routes responses by id when several requests are in flight", async () => {
    const p1 = client.call("a");
    const p2 = client.call("b");
    const id1 = (
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: number }
    ).id;
    const id2 = (
      iframe.contentWindow.postMessage.mock.calls[1][0] as { id: number }
    ).id;
    expect(id1).not.toBe(id2);

    // Reply out-of-order on purpose.
    reply(iframe, { id: id2, type: "response", result: "second" });
    reply(iframe, { id: id1, type: "response", result: "first" });

    await expect(p1).resolves.toBe("first");
    await expect(p2).resolves.toBe("second");
  });

  it("times out a pending request when no reply arrives", async () => {
    vi.useFakeTimers();
    try {
      const promise = client.call("slow", undefined, 100);
      vi.advanceTimersByTime(150);
      await expect(promise).rejects.toThrow(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores messages whose source isn't the iframe", async () => {
    const promise = client.call("a");
    const id = (
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: number }
    ).id;

    // Replay from a *different* source — must be ignored.
    const fakeOther = { postMessage: vi.fn() };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { id, type: "response", result: "spoofed" },
        source: fakeOther as unknown as MessageEventSource,
      }),
    );
    // Now the real iframe replies — that one is honoured.
    reply(iframe, { id, type: "response", result: "ok" });

    await expect(promise).resolves.toBe("ok");
  });

  it("dispatches event payloads to ``on()`` listeners", () => {
    const cb = vi.fn();
    client.on("object-changed", cb);
    reply(iframe, {
      type: "event",
      name: "object-changed",
      payload: { oid: "x" },
    });
    expect(cb).toHaveBeenCalledWith({ oid: "x" });
  });

  it("dispose() rejects pending calls and stops listening", async () => {
    const promise = client.call("never");
    client.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
    // After dispose, further calls reject immediately.
    await expect(client.call("again")).rejects.toThrow(/disposed/);
  });
});
