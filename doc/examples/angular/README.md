# Embedding DataLab-Web in an Angular application

This folder contains a self-contained reference integration showing
how to embed [DataLab-Web](../../../README.md) inside an existing
Angular application and drive it from your own UI through the
`DataLabWebClient` SDK.

It mirrors the vanilla-JS demo in
[`public/remote-host-example.html`](../../../public/remote-host-example.html),
adapted to Angular conventions:

- `datalab-web.service.ts` — injectable service that owns the
  `DataLabWebClient` instance, exposes its API as observables /
  signals, and hides the iframe lifecycle.
- `datalab-web-frame.component.ts` — standalone component rendering
  the `<iframe>` and wiring it to the service.
- `datalab-web-demo.component.ts` — example consumer mirroring the
  buttons + log of the vanilla demo, demonstrating signal/image push,
  processing and read-back.

> **No Angular tooling is added to this repository.** The files are
> pure TypeScript snippets meant to be copy-pasted into an existing
> Angular workspace. They are not compiled or linted by DataLab-Web's
> build system.

## Prerequisites

- Angular 17+ (uses standalone components and the
  [signals API](https://angular.dev/guide/signals)). The same code
  trivially adapts to Angular 16 with `NgModule` declarations.
- A reachable DataLab-Web deployment. Two common setups:
  1. **Same origin**: serve the static DataLab-Web bundle (the
     contents of `dist/` after `npm run build`) from your Angular app
     under, e.g., `/datalab-web/`.
  2. **Different origin**: host DataLab-Web on a separate domain or port.

  In both cases the iframe URL must include `?allowedOrigins=<your-app-origin>`: without it, DataLab-Web does not activate the bridge and ignores postMessage calls from your app.

## Step 1 — Install the SDK

The DataLab-Web SDK is distributed as a self-contained npm tarball
(`datalab-platform-web-sdk-<version>.tgz`) produced by the
DataLab-Web release pipeline. Drop the tarball anywhere reachable
from your project and install it locally:

```sh
npm install ./vendor/datalab-platform-web-sdk-<version>.tgz
```

The package has **zero runtime dependencies** — it only needs the
DOM types, which are always available in Angular projects.

> Once the SDK is published to a public registry, this step will
> become `npm install @datalab-platform/web-sdk`.

## Step 2 — Drop in the three files

Copy `datalab-web.service.ts`, `datalab-web-frame.component.ts` and
`datalab-web-demo.component.ts` into your project (any location is
fine, e.g. `src/app/datalab-web/`).

The service imports the SDK from the npm package name:

```ts
import { DataLabWebClient } from "@datalab-platform/web-sdk";
```

If you previously vendored the SDK source file, replace the relative
import with the package name above.

## Step 3 — Configure the embed URL

Both the iframe `src` and the SDK's `targetOrigin` must agree on the
same origin: the frame component derives `targetOrigin` from `src`.
Edit the `DATALAB_WEB_URL` token at the top of
`datalab-web-frame.component.ts` (or wire it to your environment
config) to point at the deployed DataLab-Web, and make sure its origin
is listed in `TRUSTED_DATALAB_WEB_ORIGINS` (see below). Typical values:

```ts
// Same origin (Angular dev server proxies /datalab-web to the bundle):
const DATALAB_WEB_URL =
  "/datalab-web/index.html?allowedOrigins=" +
  encodeURIComponent(window.location.origin);

// Cross-origin deployment (add "https://datalab.example.com" to
// TRUSTED_DATALAB_WEB_ORIGINS):
const DATALAB_WEB_URL =
  "https://datalab.example.com/?allowedOrigins=" +
  encodeURIComponent(window.location.origin);
```

The `allowedOrigins` query parameter restricts which parent windows the bridge accepts requests from. **Always set it**: without it, the bridge is not activated.

### Trusted DataLab-Web origins

An iframe `src` is a [resource URL security context](https://angular.dev/best-practices/security#sanitization-and-security-contexts): Angular refuses to bind a plain string to it, and marking an arbitrary string as trusted would let a crafted URL load any page in your application. The frame component therefore validates `src` before trusting it:

- the URL must use `https:`, or `http:` on `localhost` or `127.0.0.1` for development;
- its origin must be listed in `TRUSTED_DATALAB_WEB_ORIGINS`, at the top of `datalab-web-frame.component.ts`. The list holds the origin of your application, for the same-origin setup, and the public deployment `https://datalab-platform.com`. Add the origins of your own deployments, such as `https://datalab.example.com` or a local development server like `http://localhost:5173`, and remove the entries you do not use.

The component throws an error for any other URL, and only calls `DomSanitizer.bypassSecurityTrustResourceUrl` with a URL that passed these checks: this call disables Angular's protection for the value it receives, so it must never receive an unchecked string. The origin of the validated URL is also the `targetOrigin` given to the SDK, so requests only go to an origin of the allow-list. Never bind a user-controlled string (query parameter, form field, stored setting…) to `src`.

## Step 4 — Use it

```html
<!-- app.component.html -->
<datalab-web-demo />
```

```ts
// app.component.ts
import { Component } from "@angular/core";
import { DataLabWebDemoComponent } from "./datalab-web/datalab-web-demo.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [DataLabWebDemoComponent],
  template: `<datalab-web-demo />`,
})
export class AppComponent {}
```

Or skip the demo and embed the bare iframe yourself:

```html
<datalab-web-frame (ready)="onReady($event)" />
<button (click)="pushSignal()">Push a signal</button>
```

```ts
import { inject } from '@angular/core';
import { DataLabWebService } from './datalab-web/datalab-web.service';

constructor() {
  // Inject the service and call its methods.
}
private dlw = inject(DataLabWebService);

onReady(version: string) {
  console.log('DataLab-Web is ready, version', version);
}

async pushSignal() {
  const N = 256;
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    xs[i] = i / N;
    ys[i] = Math.sin(2 * Math.PI * 5 * xs[i]);
  }
  const id = await this.dlw.addSignal('Sine 5 Hz', xs, ys);
  console.log('pushed signal', id);
}
```

## Notes on change detection

The service uses [signals](https://angular.dev/guide/signals) to expose `ready`, `lastError` and `objectsCount`, so any component template that reads them is automatically re-rendered when DataLab-Web emits a `model-changed` event. This event follows every workspace change requested through the bridge (by your app or another host window), not the changes made interactively inside DataLab-Web. If you target Angular ≤ 15, replace the signals with `BehaviorSubject` / `async` pipe.

## Notes on the binary fast path

`DataLabWebClient` sends `Float64Array` payloads (and the flat typed array of `addImage`) through `postMessage` as binary blocks. By default, `postMessage` copies them, so your application keeps its arrays, even when signal X and Y are two views of the same buffer. `Float32Array` and plain `number[]` inputs are converted to new `Float64Array` values first.

To avoid this copy for large data, create the client with `transferArrays: true` (in `DataLabWebService.attach`: `new DataLabWebClient(iframe, { targetOrigin, transferArrays: true })`): the buffers are then transferred zero-copy, each once, and your arrays are detached (emptied) once the request is sent. Pass copies of the data you still need.

## Compatibility & versioning

The SDK and the DataLab-Web bundle negotiate a **wire-protocol
version** (semver `MAJOR.MINOR`, distinct from the application
version) when `client.ready()` is called. The promise rejects if the
two sides disagree on `MAJOR`. The current value is exposed as
`client.protocolVersion`.

| SDK release | Bundle MAJOR supported |
| ----------- | ---------------------- |
| `0.x`       | `1`                    |

When you upgrade either side, install matching `.tgz` files from the
same DataLab-Web release. Mixing a SDK from release `N` with a bundle
from release `N+1` is supported as long as the MAJOR is unchanged.

## Hosting checklist

Before shipping the integration to production, verify:

1. The bundle is served from a stable URL — the bundle uses relative asset URLs (Vite `base: "./"`), so any sub-path works.
2. The iframe `src` includes `?allowedOrigins=<your-app-origin>` (URL-encoded,
   comma-separated for multiple origins). Never use `*` outside development.
   Its origin is listed in `TRUSTED_DATALAB_WEB_ORIGINS`, which holds only the
   origins you use.
3. The host page's CSP allows `frame-src` for the bundle origin
   (and `worker-src 'self' blob:` if your CSP is strict — Pyodide uses workers).
4. Static assets under `assets/` are served with long-lived cache headers
   (their filenames are hashed).
5. The SDK and bundle versions match the compatibility matrix above.
