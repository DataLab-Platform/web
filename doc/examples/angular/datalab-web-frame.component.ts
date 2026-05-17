// @ts-nocheck -- documentation snippet: ``@angular/core`` is not
// installed in this repo; type-checking is disabled so the file
// stays editor-clean.  In your real Angular project, remove this
// directive — actual types will apply.
/**
 * Standalone Angular component that mounts the DataLab-Web iframe
 * and hands it off to ``DataLabWebService``.
 *
 * Usage:
 *
 * ```html
 * <datalab-web-frame
 *   [src]="datalabUrl"
 *   (ready)="onReady($event)"
 *   (failed)="onFailed($event)"
 * />
 * ```
 *
 * The ``src`` input is what gets put on the ``<iframe>`` ``src``
 * attribute. It MUST include an ``allowedOrigins`` query parameter
 * matching ``window.location.origin`` (URL-encoded), otherwise the
 * bridge inside DataLab-Web will silently drop your postMessage
 * calls — see ``README.md`` for setup details.
 *
 * Drop this file into your Angular app under, e.g.,
 * ``src/app/datalab-web/datalab-web-frame.component.ts``.
 */

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";

import { DataLabWebService } from "./datalab-web.service";

/** Default URL — override via the ``[src]`` input or by editing this
 *  module-level constant if your deployment is fixed. */
export const DATALAB_WEB_URL =
  "/datalab-web/index.html?allowedOrigins=" +
  encodeURIComponent(
    typeof window === "undefined" ? "" : window.location.origin,
  );

@Component({
  selector: "datalab-web-frame",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <iframe
      #frame
      [src]="src"
      title="DataLab-Web"
      [style.width]="'100%'"
      [style.height]="'100%'"
      [style.border]="'0'"
    ></iframe>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class DataLabWebFrameComponent implements AfterViewInit, OnDestroy {
  /** Iframe URL. Defaults to ``DATALAB_WEB_URL``. */
  @Input() src: string = DATALAB_WEB_URL;

  /** Emitted with the DataLab-Web version string when the bridge
   *  handshake succeeds. */
  @Output() ready = new EventEmitter<string>();

  /** Emitted if the bridge handshake fails (timeout, navigation
   *  error, etc.). */
  @Output() failed = new EventEmitter<Error>();

  @ViewChild("frame", { static: true })
  private frameRef!: ElementRef<HTMLIFrameElement>;

  private readonly dlw = inject(DataLabWebService);

  async ngAfterViewInit(): Promise<void> {
    const iframe = this.frameRef.nativeElement;
    // ``targetOrigin`` for postMessage must be the iframe's origin.
    // ``URL`` resolves relative paths against the document base, so
    // both same-origin and cross-origin URLs are handled uniformly.
    const targetOrigin = new URL(iframe.src, window.location.href).origin;
    try {
      await this.dlw.attach(iframe, targetOrigin);
      const v = this.dlw.version();
      this.ready.emit(v ?? "");
    } catch (err) {
      this.failed.emit(err as Error);
    }
  }

  ngOnDestroy(): void {
    this.dlw.detach();
  }
}
