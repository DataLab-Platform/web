import { beforeEach, describe, expect, it, vi } from "vitest";

import { provide } from "./angular/core";
import { DomSanitizer } from "./angular/platform-browser";

const sdk = vi.hoisted(() => {
  const clients: {
    resolveReady: (value: string) => void;
    rejectReady: (error: Error) => void;
    listSignals: ReturnType<typeof vi.fn>;
    listImages: ReturnType<typeof vi.fn>;
    getVersion: ReturnType<typeof vi.fn>;
  }[] = [];

  class Client {
    resolveReady!: (value: string) => void;
    rejectReady!: (error: Error) => void;
    private readonly readyPromise = new Promise<string>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    ready = vi.fn(() => this.readyPromise);
    dispose = vi.fn();
    on = vi.fn(() => vi.fn());
    listSignals = vi.fn(async () => []);
    listImages = vi.fn(async () => []);
    getVersion = vi.fn(async () => "version");

    constructor() {
      clients.push(this);
    }
  }

  return { Client, clients };
});

vi.mock("@datalab-platform/web-sdk", () => ({ DataLabWebClient: sdk.Client }));

import { DataLabWebFrameComponent } from "../../doc/examples/angular/datalab-web-frame.component";
import { DataLabWebService } from "../../doc/examples/angular/datalab-web.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("Angular example lifecycle", () => {
  beforeEach(() => {
    sdk.clients.length = 0;
  });

  it("uses one connection for rapid URL changes and ignores old failures", async () => {
    const first = deferred<void>();
    const service = {
      attach: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue(undefined),
      detach: vi.fn(),
      version: () => "current",
    };
    provide(DataLabWebService, service);
    provide(DomSanitizer, new DomSanitizer());
    const component = new DataLabWebFrameComponent();
    const frame = document.createElement("iframe");
    Reflect.set(component, "frameRef", { nativeElement: frame });
    component.ngAfterViewInit();
    component.src = "https://datalab-platform.com/web/?a=1";
    component.ngOnChanges({ src: { firstChange: false } });
    component.src = "/datalab-web/index.html?a=2";
    component.ngOnChanges({ src: { firstChange: false } });
    expect(service.detach).toHaveBeenCalledTimes(2);
    frame.dispatchEvent(new Event("load"));
    await flush();
    expect(service.attach).toHaveBeenCalledTimes(2);
    expect(service.attach).toHaveBeenLastCalledWith(
      frame,
      window.location.origin,
    );
    expect(component.ready.emit).toHaveBeenCalledOnce();
    first.reject(new Error("obsolete"));
    await flush();
    expect(component.failed.emit).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it("ignores pending loads and completions after destruction", async () => {
    const first = deferred<void>();
    const service = {
      attach: vi.fn().mockReturnValue(first.promise),
      detach: vi.fn(),
      version: () => "old",
    };
    provide(DataLabWebService, service);
    provide(DomSanitizer, new DomSanitizer());
    const component = new DataLabWebFrameComponent();
    const frame = document.createElement("iframe");
    Reflect.set(component, "frameRef", { nativeElement: frame });
    component.ngAfterViewInit();
    component.src = "/datalab-web/index.html?a=1";
    component.ngOnChanges({ src: { firstChange: false } });
    component.ngOnDestroy();
    frame.dispatchEvent(new Event("load"));
    first.resolve();
    await flush();
    expect(service.attach).toHaveBeenCalledOnce();
    expect(component.ready.emit).not.toHaveBeenCalled();
    expect(component.failed.emit).not.toHaveBeenCalled();
  });

  it("reports a failure from the current connection", async () => {
    const failure = new Error("iframe did not become ready");
    const service = {
      attach: vi.fn().mockRejectedValue(failure),
      detach: vi.fn(),
      version: () => null,
    };
    provide(DataLabWebService, service);
    provide(DomSanitizer, new DomSanitizer());
    const component = new DataLabWebFrameComponent();
    Reflect.set(component, "frameRef", {
      nativeElement: document.createElement("iframe"),
    });
    component.ngAfterViewInit();
    await flush();
    expect(component.failed.emit).toHaveBeenCalledExactlyOnceWith(failure);
    expect(component.ready.emit).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it("does not publish readiness or errors from a replaced service client", async () => {
    const service = new DataLabWebService();
    const frame = document.createElement("iframe");
    const first = service.attach(frame, window.location.origin);
    const firstFailure = expect(first).rejects.toThrow("superseded");
    const old = sdk.clients[0];
    old.resolveReady("old");
    const second = service.attach(frame, window.location.origin);
    await flush();
    expect(service.ready()).toBe(false);
    expect(service.version()).toBeNull();
    sdk.clients[1].resolveReady("current");
    await Promise.all([firstFailure, second]);
    expect(service.ready()).toBe(true);
    expect(service.version()).toBe("current");
    expect(service.lastError()).toBeNull();
    service.detach();
  });

  it("does not publish a replaced client's late count", async () => {
    const service = new DataLabWebService();
    const frame = document.createElement("iframe");
    const first = service.attach(frame, window.location.origin);
    const firstFailure = expect(first).rejects.toThrow("superseded");
    const old = sdk.clients[0];
    const signals = deferred<unknown[]>();
    old.listSignals.mockReturnValue(signals.promise);
    old.resolveReady("old");
    await flush();
    const second = service.attach(frame, window.location.origin);
    sdk.clients[1].listSignals.mockResolvedValue([{}, {}]);
    sdk.clients[1].resolveReady("current");
    await second;
    expect(service.objectsCount()).toBe(2);
    signals.resolve([{}]);
    await firstFailure;
    expect(service.objectsCount()).toBe(2);
    service.detach();
  });

  it("does not publish an error from a replaced service client", async () => {
    const service = new DataLabWebService();
    const frame = document.createElement("iframe");
    const first = service.attach(frame, window.location.origin);
    const firstFailure = expect(first).rejects.toThrow("obsolete");
    const second = service.attach(frame, window.location.origin);
    sdk.clients[1].resolveReady("current");
    await second;
    sdk.clients[0].rejectReady(new Error("obsolete"));
    await firstFailure;
    expect(service.lastError()).toBeNull();
    expect(service.ready()).toBe(true);
    service.detach();
  });

  it("exposes a failure from the current service client", async () => {
    const service = new DataLabWebService();
    const connection = service.attach(
      document.createElement("iframe"),
      window.location.origin,
    );
    const failure = new Error("iframe did not become ready");
    sdk.clients[0].rejectReady(failure);
    await expect(connection).rejects.toBe(failure);
    expect(service.lastError()).toBe(failure);
    expect(service.ready()).toBe(false);
    service.detach();
  });

  it("does not publish an error from a call on a replaced client", async () => {
    const service = new DataLabWebService();
    const frame = document.createElement("iframe");
    const first = service.attach(frame, window.location.origin);
    sdk.clients[0].resolveReady("old");
    await first;
    const response = deferred<string>();
    sdk.clients[0].getVersion.mockReturnValue(response.promise);
    const call = service.getVersion();
    const failed = expect(call).rejects.toThrow("obsolete call");
    const second = service.attach(frame, window.location.origin);
    sdk.clients[1].resolveReady("current");
    await second;
    response.reject(new Error("obsolete call"));
    await failed;
    expect(service.lastError()).toBeNull();
    service.detach();
  });
});
