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
} from "../../packages/sdk/src";

interface FakeIframe {
  contentWindow: { postMessage: ReturnType<typeof vi.fn> };
}

/** The fake iframe clones each message like a browser: transferred buffers
 *  are detached, and a transfer list repeating a buffer throws a
 *  ``DataCloneError``. */
function makeFakeIframe(): FakeIframe {
  return {
    contentWindow: {
      postMessage: vi.fn(
        (message: unknown, _origin: string, transfer?: Transferable[]) => {
          structuredClone(message, { transfer });
        },
      ),
    },
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
    const id = (request as { id: string }).id;

    reply(iframe, { id, type: "response", result: "9.9.9" });
    await expect(promise).resolves.toBe("9.9.9");
  });

  it("rejects with DataLabWebRemoteError when the response carries an error", async () => {
    const promise = client.call("nope");
    const id = (
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: string }
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
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: string }
    ).id;
    const id2 = (
      iframe.contentWindow.postMessage.mock.calls[1][0] as { id: string }
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
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: string }
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

  it("ignores messages of the iframe window from another origin", async () => {
    // The iframe window keeps its identity when it navigates to another
    // document: its messages must also come from the expected origin.
    const promise = client.call("a");
    const id = (
      iframe.contentWindow.postMessage.mock.calls[0][0] as { id: string }
    ).id;
    const cb = vi.fn();
    client.on("model-changed", cb);
    for (const data of [
      { id, type: "response", result: "spoofed" },
      { type: "event", name: "model-changed", payload: { panel: "x" } },
    ]) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          source: iframe.contentWindow as unknown as MessageEventSource,
          origin: "https://different.example",
        }),
      );
    }
    expect(cb).not.toHaveBeenCalled();

    reply(iframe, { id, type: "response", result: "ok" });
    await expect(promise).resolves.toBe("ok");
  });

  it("accepts any origin when targetOrigin is the wildcard", async () => {
    const anyIframe = makeFakeIframe();
    const anyClient = new DataLabWebClient(
      anyIframe as unknown as HTMLIFrameElement,
      { targetOrigin: "*" },
    );
    try {
      const promise = anyClient.call("a");
      const id = (
        anyIframe.contentWindow.postMessage.mock.calls[0][0] as { id: string }
      ).id;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { id, type: "response", result: "ok" },
          source: anyIframe.contentWindow as unknown as MessageEventSource,
          origin: "http://localhost:5173",
        }),
      );
      await expect(promise).resolves.toBe("ok");
    } finally {
      anyClient.dispose();
    }
  });

  it("dispose() rejects pending calls and stops listening", async () => {
    const promise = client.call("never");
    client.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
    // After dispose, further calls reject immediately.
    await expect(client.call("again")).rejects.toThrow(/disposed/);
  });

  it("does not accept an old client's response for its replacement", async () => {
    const oldRequest = client.getVersion();
    const oldId = (
      iframe.contentWindow.postMessage.mock.calls[0][0] as {
        id: number | string;
      }
    ).id;
    const oldRejection = expect(oldRequest).rejects.toThrow(/disposed/);
    client.dispose();
    await oldRejection;

    const replacement = new DataLabWebClient(
      iframe as unknown as HTMLIFrameElement,
      { targetOrigin: "http://iframe.test" },
    );
    try {
      const currentRequest = replacement.getVersion();
      const currentId = (
        iframe.contentWindow.postMessage.mock.calls[1][0] as {
          id: number | string;
        }
      ).id;
      const settled = vi.fn();
      void currentRequest.then(settled);
      reply(iframe, { id: oldId, type: "response", result: "obsolete" });
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      reply(iframe, { id: currentId, type: "response", result: "current" });
      await expect(currentRequest).resolves.toBe("current");
    } finally {
      replacement.dispose();
    }
  });

  it("isolates concurrent clients connected to the same iframe", async () => {
    const other = new DataLabWebClient(iframe as unknown as HTMLIFrameElement, {
      targetOrigin: "http://iframe.test",
    });
    try {
      const first = client.getVersion();
      const second = other.getVersion();
      const firstId = (
        iframe.contentWindow.postMessage.mock.calls[0][0] as {
          id: string;
        }
      ).id;
      const secondId = (
        iframe.contentWindow.postMessage.mock.calls[1][0] as {
          id: string;
        }
      ).id;
      expect(firstId).not.toBe(secondId);
      reply(iframe, { id: secondId, type: "response", result: "second" });
      reply(iframe, { id: firstId, type: "response", result: "first" });
      await expect(first).resolves.toBe("first");
      await expect(second).resolves.toBe("second");
    } finally {
      other.dispose();
    }
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
    const id = (request as { id: string }).id;
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
    const id = (request as { id: string }).id;
    reply(iframe, { id, type: "response", result: "img-1" });
    await expect(promise).resolves.toBe("img-1");
  });

  /** Reply ``result`` to the ``index``-th request posted to ``target``. */
  function replyTo(target: FakeIframe, index: number, result: unknown): void {
    const { id } = target.contentWindow.postMessage.mock.calls[index][0] as {
      id: string;
    };
    reply(target, { id, type: "response", result });
  }

  it("copies arrays by default, leaving the caller's arrays usable", async () => {
    const xs = new Float64Array([0, 1, 2, 3]);
    const ys = new Float64Array([10, 11, 12, 13]);
    const pixels = new Float32Array(2 * 3);
    // Two views of one buffer, e.g. X and Y stored together by the caller
    const shared = new Float64Array(8);
    const promises = [
      client.addSignal("Probe", xs, ys),
      client.addImage("Img", { width: 3, height: 2, data: pixels }),
      client.addSignal("Shared", shared.subarray(0, 4), shared.subarray(4)),
    ];
    const calls = iframe.contentWindow.postMessage.mock.calls;
    expect(calls.map((call) => call[2])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect([xs.length, ys.length, pixels.length, shared.length]).toEqual([
      4, 4, 6, 8,
    ]);
    promises.forEach((_promise, index) =>
      replyTo(iframe, index, `obj-${index}`),
    );
    await expect(Promise.all(promises)).resolves.toEqual([
      "obj-0",
      "obj-1",
      "obj-2",
    ]);
  });

  describe("with transferArrays", () => {
    let transferIframe: FakeIframe;
    let transferClient: DataLabWebClient;

    beforeEach(() => {
      transferIframe = makeFakeIframe();
      transferClient = new DataLabWebClient(
        transferIframe as unknown as HTMLIFrameElement,
        { targetOrigin: "http://iframe.test", transferArrays: true },
      );
    });

    afterEach(() => {
      transferClient.dispose();
    });

    it("transfers a buffer shared by X and Y once", async () => {
      const buffer = new ArrayBuffer(8 * Float64Array.BYTES_PER_ELEMENT);
      const xs = new Float64Array(buffer, 0, 4);
      const ys = new Float64Array(buffer, 4 * Float64Array.BYTES_PER_ELEMENT);
      const promise = transferClient.addSignal("Shared", xs, ys);
      const [, , transfer] = transferIframe.contentWindow.postMessage.mock
        .calls[0] as [unknown, string, Transferable[]];
      expect(transfer).toHaveLength(1);
      expect(transfer[0]).toBe(buffer);
      expect(xs.length).toBe(0);
      replyTo(transferIframe, 0, "obj-1");
      await expect(promise).resolves.toBe("obj-1");
    });

    it("transfers every distinct buffer", async () => {
      const xs = new Float64Array([0, 1, 2, 3]);
      const ys = new Float64Array([10, 11, 12, 13]);
      const buffers = [xs.buffer, ys.buffer];
      const promise = transferClient.addSignal("Probe", xs, ys);
      const [, , transfer] = transferIframe.contentWindow.postMessage.mock
        .calls[0] as [unknown, string, Transferable[]];
      expect(transfer).toHaveLength(2);
      expect(transfer).toContain(buffers[0]);
      expect(transfer).toContain(buffers[1]);
      expect([xs.length, ys.length]).toEqual([0, 0]);
      replyTo(transferIframe, 0, "obj-1");
      await expect(promise).resolves.toBe("obj-1");
    });
  });

  it("getSignalXY decodes binary float64 payloads zero-copy", async () => {
    const xs = new Float64Array([1.5, 2.5, 3.5, 4.5]);
    const ys = new Float64Array([-1, 0, 1, 2]);
    const promise = client.getSignalXY("oid-42");
    const [request] = iframe.contentWindow.postMessage.mock.calls[0];
    const params = (request as { params: { encoding?: string } }).params;
    expect(params.encoding).toBe("bytes");
    const id = (request as { id: string }).id;
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

  // ----------------------------------------------------------------------
  // Protocol-version negotiation in ``ready()``.
  // ----------------------------------------------------------------------

  /** Pump pending microtasks/timers so the SDK's polling loop advances. */
  async function pump(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  it.each(["pending request", "retry delay"])(
    "cancels ready() promptly on disposal during %s",
    async (stage) => {
      vi.useFakeTimers();
      try {
        const rejected = vi.fn();
        void client.ready(60_000).catch(rejected);
        if (stage === "retry delay") {
          const id = (
            iframe.contentWindow.postMessage.mock.calls[0][0] as {
              id: number | string;
            }
          ).id;
          reply(iframe, {
            id,
            type: "response",
            error: { code: "method_error", message: "not ready" },
          });
          await pump();
        }
        client.dispose();
        await pump();
        expect(rejected).toHaveBeenCalledOnce();
        expect(rejected.mock.calls[0][0]).toMatchObject({
          message: expect.stringMatching(/disposed/),
        });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("rejects ready() immediately when already disposed", async () => {
    vi.useFakeTimers();
    try {
      client.dispose();
      const rejected = vi.fn();
      void client.ready().catch(rejected);
      await pump();
      expect(rejected).toHaveBeenCalledOnce();
      expect(rejected.mock.calls[0][0]).toMatchObject({
        message: expect.stringMatching(/disposed/),
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Drive the ``ready()`` polling loop with scripted iframe responses.
   *  Returns when both ``get_version`` and ``get_protocol_version`` (or
   *  the version-only path, for the legacy fallback) have been served.
   *
   *  ``onProtocolRequest`` returns either a ``{ result }`` to resolve
   *  with, or an ``{ error }`` to reject with. Returning ``null`` means
   *  "do not reply" (used to test malformed remote behaviour). */
  async function driveReady(
    versionResult: string,
    onProtocolRequest: () =>
      { result: string } | { error: { code: string; message: string } } | null,
  ): Promise<void> {
    await pump();
    // First request is always ``get_version``.
    const versionCall = iframe.contentWindow.postMessage.mock.calls[0][0] as {
      id: string;
      method: string;
    };
    expect(versionCall.method).toBe("get_version");
    reply(iframe, {
      id: versionCall.id,
      type: "response",
      result: versionResult,
    });
    await pump();
    // Second request is ``get_protocol_version``.
    const protoCall = iframe.contentWindow.postMessage.mock.calls[1][0] as {
      id: string;
      method: string;
    };
    expect(protoCall.method).toBe("get_protocol_version");
    const next = onProtocolRequest();
    if (next === null) return;
    reply(iframe, {
      id: protoCall.id,
      type: "response",
      ...next,
    });
  }

  it("ready() resolves and exposes the negotiated protocolVersion", async () => {
    const promise = client.ready(5_000);
    await driveReady("9.9.9", () => ({ result: "1.0" }));
    await expect(promise).resolves.toBe("9.9.9");
    expect(client.protocolVersion).toBe("1.0");
  });

  it("does not reuse a completed ready() promise after disposal", async () => {
    const promise = client.ready(5_000);
    await driveReady("9.9.9", () => ({ result: "1.0" }));
    await expect(promise).resolves.toBe("9.9.9");
    client.dispose();
    await expect(client.ready()).rejects.toThrow(/disposed/);
  });

  it("ready() accepts forward-compatible MINOR bumps within MAJOR 1", async () => {
    const promise = client.ready(5_000);
    await driveReady("9.9.9", () => ({ result: "1.42" }));
    await expect(promise).resolves.toBe("9.9.9");
    expect(client.protocolVersion).toBe("1.42");
  });

  it("ready() rejects when the iframe reports an incompatible MAJOR", async () => {
    const promise = client.ready(5_000);
    await driveReady("9.9.9", () => ({ result: "2.0" }));
    await expect(promise).rejects.toThrow(/wire-protocol mismatch/);
    expect(client.protocolVersion).toBeNull();
  });

  it("ready() falls back to protocol 1.0 when the bundle predates versioning", async () => {
    const promise = client.ready(5_000);
    await driveReady("9.9.9", () => ({
      error: { code: "unknown_method", message: "Unknown method" },
    }));
    await expect(promise).resolves.toBe("9.9.9");
    expect(client.protocolVersion).toBe("1.0");
  });
});
