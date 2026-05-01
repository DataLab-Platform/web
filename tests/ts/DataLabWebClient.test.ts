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

  it("addSignal forwards Float64Array payloads without copying to JS lists", async () => {
    // The legacy implementation called ``Array.from`` on each input,
    // boxing every sample into a ``Number`` — at 1 M samples that
    // alone allocated tens of MB and dominated the round-trip cost.
    // The optimised path must hand a typed array straight to the
    // bridge so structured-clone (and Pyodide downstream) treat it
    // as a single binary blob.
    const xs = new Float64Array([0, 1, 2, 3]);
    const ys = new Float64Array([10, 11, 12, 13]);
    const promise = client.addSignal("Probe", xs, ys);
    const [request] = iframe.contentWindow.postMessage.mock.calls[0];
    const params = (request as { params: { xdata: unknown; ydata: unknown } })
      .params;
    expect(params.xdata).toBeInstanceOf(Float64Array);
    expect(params.ydata).toBeInstanceOf(Float64Array);
    const id = (request as { id: number }).id;
    reply(iframe, { id, type: "response", result: "obj-1" });
    await expect(promise).resolves.toBe("obj-1");
  });

  it("addImage flat-buffer mode forwards width/height/dtype", async () => {
    const data = new Float32Array(2 * 3);
    const promise = client.addImage("Img", { width: 3, height: 2, data });
    const [request] = iframe.contentWindow.postMessage.mock.calls[0];
    const params = (
      request as {
        params: {
          data: unknown;
          width: number;
          height: number;
          dtype: string;
        };
      }
    ).params;
    expect(params.data).toBeInstanceOf(Float32Array);
    expect(params.width).toBe(3);
    expect(params.height).toBe(2);
    expect(params.dtype).toBe("float32");
    const id = (request as { id: number }).id;
    reply(iframe, { id, type: "response", result: "img-1" });
    await expect(promise).resolves.toBe("img-1");
  });

  it("getSignalXY decodes binary float64 payloads zero-copy", async () => {
    const xs = new Float64Array([1.5, 2.5, 3.5, 4.5]);
    const ys = new Float64Array([-1, 0, 1, 2]);
    const promise = client.getSignalXY("oid-42");
    const [request] = iframe.contentWindow.postMessage.mock.calls[0];
    const params = (request as { params: { encoding?: string } }).params;
    expect(params.encoding).toBe("bytes");
    const id = (request as { id: number }).id;
    reply(iframe, {
      id,
      type: "response",
      result: {
        id: "oid-42",
        encoding: "f64",
        dtype: "float64",
        size: xs.length,
        x_bytes: new Uint8Array(xs.buffer.slice(0)),
        y_bytes: new Uint8Array(ys.buffer.slice(0)),
      },
    });
    const data = (await promise) as { x: Float64Array; y: Float64Array };
    expect(data.x).toBeInstanceOf(Float64Array);
    expect(data.y).toBeInstanceOf(Float64Array);
    expect(Array.from(data.x)).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(Array.from(data.y)).toEqual([-1, 0, 1, 2]);
  });
});
