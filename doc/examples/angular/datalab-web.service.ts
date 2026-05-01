// @ts-nocheck -- documentation snippet: ``@angular/core`` and the
// vendored SDK are not installed in this repo; type-checking is
// disabled so the file stays editor-clean.  In your real Angular
// project, remove this directive — actual types will apply.
/**
 * Angular service wrapping the ``DataLabWebClient`` SDK.
 *
 * Exposes a single, app-wide handle on the embedded DataLab-Web
 * instance. The iframe is mounted by ``DataLabWebFrameComponent``,
 * which calls ``attach()`` once the DOM element is available; any
 * component in the app can then ``inject(DataLabWebService)`` and
 * drive DataLab-Web through Promise-returning methods.
 *
 * The service is purely a thin façade: it does not duplicate the
 * SDK's surface, it forwards. The two reasons it exists at all are:
 *
 *   1. lifecycle — Angular DI gives us a single instance whose
 *      ``DataLabWebClient`` is disposed when the root injector is
 *      torn down, instead of leaking a postMessage listener;
 *   2. reactive state — three signals (``ready``, ``lastError``,
 *      ``objectsCount``) reflect the bridge state, so templates can
 *      bind to them with no manual change-detection.
 *
 * Drop this file into your Angular app under, e.g.,
 * ``src/app/datalab-web/datalab-web.service.ts`` and adjust the SDK
 * import path to match where you vendored ``DataLabWebClient.ts``.
 */

import { Injectable, OnDestroy, signal } from '@angular/core';

import {
  DataLabWebClient,
  type SignalXY,
  type ImageData2D,
} from './sdk/DataLabWebClient';

@Injectable({ providedIn: 'root' })
export class DataLabWebService implements OnDestroy {
  /** ``true`` once the embedded DataLab-Web has booted Pyodide and
   *  responded to the initial handshake. Bind from templates with
   *  ``@if (dlw.ready()) { … }`` (Angular 17+) or the ``async`` pipe
   *  on a wrapping observable. */
  readonly ready = signal(false);

  /** Last error raised by an SDK call, or ``null``. Useful for a
   *  global error banner. Cleared by ``clearError()``. */
  readonly lastError = signal<Error | null>(null);

  /** Cached signal+image count refreshed on every
   *  ``object-changed`` event. ``-1`` means "not yet known". */
  readonly objectsCount = signal(-1);

  /** DataLab-Web version string, populated when ``ready()`` resolves. */
  readonly version = signal<string | null>(null);

  private client: DataLabWebClient | null = null;
  private offObjectChanged: (() => void) | null = null;

  /** Bind the service to a freshly mounted iframe. Called from
   *  ``DataLabWebFrameComponent.ngAfterViewInit`` — you should not
   *  need to call this from feature components. */
  async attach(iframe: HTMLIFrameElement, targetOrigin: string): Promise<void> {
    if (this.client) {
      // The frame component re-attaches on hot-reload — release the
      // previous bridge before grabbing the new one.
      this.detach();
    }
    const client = new DataLabWebClient(iframe, { targetOrigin });
    this.client = client;
    this.offObjectChanged = client.on('object-changed', () => {
      void this.refreshCount();
    });
    try {
      const v = await client.ready(180_000);
      this.version.set(v);
      this.ready.set(true);
      await this.refreshCount();
    } catch (err) {
      this.lastError.set(err as Error);
      throw err;
    }
  }

  /** Tear the bridge down. Called from the frame component's
   *  ``ngOnDestroy`` so the postMessage listener is removed cleanly. */
  detach(): void {
    this.offObjectChanged?.();
    this.offObjectChanged = null;
    this.client?.dispose();
    this.client = null;
    this.ready.set(false);
    this.version.set(null);
    this.objectsCount.set(-1);
  }

  ngOnDestroy(): void {
    this.detach();
  }

  /** Reset ``lastError`` after the user dismissed an error banner. */
  clearError(): void {
    this.lastError.set(null);
  }

  // -------------------------------------------------------------------
  // Façade — typed forwards to the SDK. Add methods as you need them.
  // -------------------------------------------------------------------

  getVersion(): Promise<string> {
    return this.guard((c) => c.getVersion());
  }

  /** Push a 1-D signal. Pass ``Float64Array`` for the binary fast
   *  path on large signals (zero-copy across the iframe). */
  addSignal(
    title: string,
    xdata: number[] | Float32Array | Float64Array,
    ydata: number[] | Float32Array | Float64Array,
    extras: {
      xunit?: string;
      yunit?: string;
      xlabel?: string;
      ylabel?: string;
      group_id?: string | null;
    } = {},
  ): Promise<string> {
    return this.guard((c) => c.addSignal(title, xdata, ydata, extras));
  }

  /** Push a 2-D image. Use the flat-buffer overload on big images. */
  addImage(
    title: string,
    data:
      | number[][]
      | { width: number; height: number; data: Float32Array | Float64Array },
    extras: {
      xunit?: string;
      yunit?: string;
      zunit?: string;
      xlabel?: string;
      ylabel?: string;
      zlabel?: string;
      group_id?: string | null;
    } = {},
  ): Promise<string> {
    return this.guard((c) => c.addImage(title, data, extras));
  }

  listSignals(): Promise<unknown[]> {
    return this.guard((c) => c.listSignals());
  }

  listImages(): Promise<unknown[]> {
    return this.guard((c) => c.listImages());
  }

  getSignalXY(oid: string): Promise<SignalXY> {
    return this.guard((c) => c.getSignalXY(oid));
  }

  getImageData(oid: string): Promise<ImageData2D> {
    return this.guard((c) => c.getImageData(oid));
  }

  /** Run a registered Sigima processing on the given object(s). */
  calc(
    featureId: string,
    params: Record<string, unknown> | null = null,
    sources: string[] | null = null,
  ): Promise<string[]> {
    return this.guard((c) => c.calc(featureId, params, sources));
  }

  deleteObject(oid: string): Promise<null> {
    return this.guard((c) => c.deleteObject(oid));
  }

  resetAll(): Promise<null> {
    return this.guard((c) => c.resetAll());
  }

  /** Subscribe to a low-level RPC event and get a teardown
   *  function back. Prefer the signals above when you only need
   *  to react to model changes. */
  on(event: string, handler: (payload: unknown) => void): () => void {
    if (!this.client) {
      throw new Error('DataLab-Web bridge is not attached yet');
    }
    return this.client.on(event, handler);
  }

  // -------------------------------------------------------------------
  // Private helpers.
  // -------------------------------------------------------------------

  private async refreshCount(): Promise<void> {
    if (!this.client) return;
    try {
      const [sigs, imgs] = await Promise.all([
        this.client.listSignals(),
        this.client.listImages(),
      ]);
      this.objectsCount.set(sigs.length + imgs.length);
    } catch (err) {
      // ``object-changed`` can fire while the bridge is mid-shutdown
      // — swallow rather than spam the error signal.
      console.warn('[datalab-web] refreshCount failed', err);
    }
  }

  private async guard<T>(fn: (c: DataLabWebClient) => Promise<T>): Promise<T> {
    if (!this.client) {
      throw new Error('DataLab-Web bridge is not attached yet');
    }
    try {
      return await fn(this.client);
    } catch (err) {
      this.lastError.set(err as Error);
      throw err;
    }
  }
}
