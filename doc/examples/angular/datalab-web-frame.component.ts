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
 * Angular only binds trusted resource URLs to an iframe ``src``. The
 * component marks ``src`` as trusted only after checking that its origin
 * is in ``TRUSTED_DATALAB_WEB_ORIGINS``, and throws an error otherwise:
 * never bind a user-controlled string to ``src``.
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
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";

import { DataLabWebService } from "./datalab-web.service";

/** Default URL — override via the ``[src]`` input or by editing this
 *  module-level constant if your deployment is fixed. */
export const DATALAB_WEB_URL =
  "/datalab-web/index.html?allowedOrigins=" +
  encodeURIComponent(
    typeof window === "undefined" ? "" : window.location.origin,
  );

/** Origins trusted to serve DataLab-Web in the iframe: the origin of
 *  ``src`` must be one of them. Keep only the origins you use, and add
 *  those of your own deployments, e.g. ``"https://datalab.example.com"``
 *  or a local development server such as ``"http://localhost:5173"``.
 *  The SDK sends its requests to this same origin (``targetOrigin``). */
export const TRUSTED_DATALAB_WEB_ORIGINS: readonly string[] = [
  // This application, serving the bundle under /datalab-web/ (see
  // DATALAB_WEB_URL): remove it if this origin also serves untrusted pages
  ...(typeof window === "undefined" ? [] : [window.location.origin]),
  // Public deployment (https://datalab-platform.com/web/)
  "https://datalab-platform.com",
];

/** Return ``src`` as an absolute URL, after checking that it uses HTTPS
 *  (or HTTP on a local development host) and a trusted origin. Relative
 *  URLs are resolved like the iframe would, against the document base. */
export function trustedDataLabWebUrl(src: string): URL {
  const url = new URL(src, document.baseURI);
  const localDevelopment =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error(
      `DataLab-Web URL must use https (or http on localhost): ${url.origin}`,
    );
  }
  if (!TRUSTED_DATALAB_WEB_ORIGINS.includes(url.origin)) {
    throw new Error(
      `DataLab-Web origin ${url.origin} is not in TRUSTED_DATALAB_WEB_ORIGINS`,
    );
  }
  return url;
}

@Component({
  selector: "datalab-web-frame",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <iframe
      #frame
      [src]="safeSrc"
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
export class DataLabWebFrameComponent
  implements OnChanges, AfterViewInit, OnDestroy
{
  /** Iframe URL. Defaults to ``DATALAB_WEB_URL``. Its origin must be in
   *  ``TRUSTED_DATALAB_WEB_ORIGINS``. */
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
  private readonly sanitizer = inject(DomSanitizer);

  /** Validated ``src``: its origin is the ``targetOrigin`` of the SDK. */
  private url = trustedDataLabWebUrl(this.src);

  /** URL bound to the iframe, trusted only once validated. */
  protected safeSrc: SafeResourceUrl = this.trust(this.url);

  private generation = 0;
  private pendingLoad: (() => void) | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes["src"];
    if (!change) return;
    this.url = trustedDataLabWebUrl(this.src);
    this.safeSrc = this.trust(this.url);
    if (!change.firstChange) {
      const generation = ++this.generation;
      this.dlw.detach();
      this.removePendingLoad();
      this.pendingLoad = () => {
        this.pendingLoad = null;
        void this.connect(generation);
      };
      this.frameRef.nativeElement.addEventListener("load", this.pendingLoad, {
        once: true,
      });
    }
  }

  ngAfterViewInit(): void {
    void this.connect(this.generation);
  }

  ngOnDestroy(): void {
    this.generation++;
    this.removePendingLoad();
    this.dlw.detach();
  }

  private removePendingLoad(): void {
    if (this.pendingLoad) {
      this.frameRef.nativeElement.removeEventListener("load", this.pendingLoad);
      this.pendingLoad = null;
    }
  }

  private trust(url: URL): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.href);
  }

  private async connect(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      await this.dlw.attach(this.frameRef.nativeElement, this.url.origin);
      if (generation !== this.generation) return;
      const v = this.dlw.version();
      this.ready.emit(v ?? "");
    } catch (err) {
      if (generation === this.generation) this.failed.emit(err as Error);
    }
  }
}
