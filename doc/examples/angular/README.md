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
  2. **Different origin**: host DataLab-Web on a separate domain or
     port. In that case the iframe URL must include
     `?allowedOrigins=<your-app-origin>` so the bridge accepts
     postMessage calls from your app.

## Step 1 — Vendor the SDK

Copy `src/sdk/DataLabWebClient.ts` from this repository into your
Angular project, e.g. under
`src/app/datalab-web/sdk/DataLabWebClient.ts`. The file has zero
runtime dependencies — it only needs `DOM` types, which are always
available in Angular projects.

> Once DataLab-Web ships the SDK as an npm package, this step will
> be replaced by `npm install @datalab/web-sdk`.

## Step 2 — Drop in the three files

Copy `datalab-web.service.ts`, `datalab-web-frame.component.ts` and
`datalab-web-demo.component.ts` into your project (any location is
fine, e.g. `src/app/datalab-web/`). Adjust the relative import paths
that point to `./sdk/DataLabWebClient` if you placed it elsewhere.

## Step 3 — Configure the embed URL

Both the iframe `src` and the SDK's `targetOrigin` must agree on the
same origin. Edit the `DATALAB_WEB_URL` token at the top of
`datalab-web-frame.component.ts` (or wire it to your environment
config) to point at the deployed DataLab-Web. Typical values:

```ts
// Same origin (Angular dev server proxies /datalab-web to the bundle):
const DATALAB_WEB_URL =
  '/datalab-web/index.html?allowedOrigins=' +
  encodeURIComponent(window.location.origin);

// Cross-origin deployment:
const DATALAB_WEB_URL =
  'https://datalab.example.com/?allowedOrigins=' +
  encodeURIComponent(window.location.origin);
```

The `allowedOrigins` query parameter restricts which parent windows
the bridge accepts requests from. **Always set it** when you embed
DataLab-Web in third-party shells.

## Step 4 — Use it

```html
<!-- app.component.html -->
<datalab-web-demo />
```

```ts
// app.component.ts
import { Component } from '@angular/core';
import { DataLabWebDemoComponent } from './datalab-web/datalab-web-demo.component';

@Component({
  selector: 'app-root',
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

The service uses [signals](https://angular.dev/guide/signals) to
expose `ready`, `lastError` and `objectsCount`, so any component
template that reads them is automatically re-rendered when DataLab-Web
emits an `object-changed` event. If you target Angular ≤ 15, replace
the signals with `BehaviorSubject` / `async` pipe.

## Notes on the binary fast path

`DataLabWebClient` already passes `Float64Array` payloads zero-copy
through `postMessage`. **Always prefer typed arrays over plain
`number[]`** when pushing signals/images — the SDK boxes plain arrays
into `Float64Array` for you, but allocating the typed array upstream
saves a copy and a pass over your data.
