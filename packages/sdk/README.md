# @datalab-platform/web-sdk

Host-side TypeScript SDK to embed and control [DataLab-Web](https://github.com/DataLab-Platform/web) — the Pyodide-based browser version of [DataLab](https://github.com/DataLab-Platform/DataLab) — from any web application.

The SDK has **zero runtime dependencies**: only the DOM is required. It works in any TS/JS framework (React, Angular, Vue, Svelte, vanilla, …).

## Installation

The SDK is currently distributed as an `.tgz` tarball produced by the DataLab-Web release pipeline. Install it directly from the file:

```sh
npm install ./datalab-platform-web-sdk-<version>.tgz
```

Once published to a registry, the install command will become `npm install @datalab-platform/web-sdk`.

## Usage

```ts
import { DataLabWebClient } from "@datalab-platform/web-sdk";

const iframe = document.getElementById("dlw") as HTMLIFrameElement;
const client = new DataLabWebClient(iframe, {
  targetOrigin: "https://datalab.example.com",
});

await client.ready(); // resolves when the iframe is reachable
console.log("Protocol:", client.protocolVersion); // e.g. "1.0"

const id = await client.addSignal("Sine", xs, ys);
const ids = await client.applyFeature("fft", { sources: [id] });
const data = await client.getSignalXY(ids[0]);
```

The DataLab-Web iframe **must** be loaded with `?allowedOrigins=<host-origin>` in its URL (or `?allowedOrigins=*` for development) so the bridge accepts incoming messages.

`targetOrigin` must be the origin of the iframe document: the client only accepts responses and events coming from the iframe window **and** from that origin, so that a document from another origin loaded after navigation cannot answer in its place. These checks do not distinguish two documents from the same origin. `targetOrigin: "*"` accepts any origin and is intended for local development only. Likewise, the bridge sends its responses and events to each host window with the origin of its requests.

The typed helpers mirror DataLab's remote-control API: `getVersion`, `getProtocolVersion`, `addSignal`, `addImage`, `listSignals`, `listImages`, `getObject`, `getObjectUuids`, `deleteObject`, `getSignalXY`, `getImageData`, `applyFeature` (and its alias `calc`), `listFeatures`, `selectObjects`, `getSelection`, `setCurrentPanel`, `getCurrentPanel`, `getCurrentObjectUuid` and `resetAll`. `call(method, params)` sends any other request, and `dispose()` removes the message listener and rejects pending requests.

When navigating the iframe, dispose the old client before changing its URL and create a new client after the new document loads. Disposal also promptly rejects a pending `ready()` call; a disposed client cannot be reused. Random per-client request IDs prevent a late response to an old request from resolving a new client's request. Events have no request ID and do not identify the document that sent them.

## Typed arrays

`addSignal` sends `Float64Array` data, and `addImage` a flat `Float32Array` or `Float64Array` with its `width` and `height`, as binary blocks, much faster than plain number arrays for large data. By default, `postMessage` copies the typed arrays of a request (including those passed to `call`), so your application keeps its arrays, even when several of them share the same buffer.

To avoid this copy for large data, create the client with `transferArrays: true`:

```ts
const client = new DataLabWebClient(iframe, {
  targetOrigin: "https://datalab.example.com",
  transferArrays: true,
});
```

The buffers are then transferred zero-copy (each buffer once, even when shared by X and Y), and your typed arrays are detached (emptied) once the request is sent: pass copies of the data you still need. `Float32Array` signal data and plain number arrays are first converted to new `Float64Array` values, so they are never detached.

## Events

`client.on(name, handler)` subscribes to an event sent by the iframe and returns a function that removes the subscription:

```ts
const off = client.on("model-changed", (payload) => {
  const { panel } = payload as { panel: "signal" | "image" | null };
  console.log("Workspace changed, panel:", panel ?? "not specified");
});
// later: off();
```

The bridge currently emits a single event, `"model-changed"`, after each workspace change requested through the bridge (adding, replacing or deleting objects, adding groups, applying a processing, resetting the workspace), whichever host window requested it. Its payload is `{ panel }`: `"signal"` or `"image"` when the change concerns that panel, `null` when the bridge does not name one (for example after a deletion or a reset). Changes made interactively inside DataLab-Web do not emit it. Events are sent to the host windows that have already sent a request, such as the one sent by `client.ready()`.

## Wire-protocol versioning

`client.ready()` negotiates a wire-protocol version with the iframe (semver `MAJOR.MINOR`). It rejects if the iframe reports a MAJOR incompatible with the SDK (`SUPPORTED_PROTOCOL_MAJOR`).

| Bump  | Trigger                                                       |
| ----- | ------------------------------------------------------------- |
| MAJOR | breaking change to message shape or method semantics          |
| MINOR | backwards-compatible additions (new methods, optional fields) |

If the iframe predates protocol versioning (no `get_protocol_version` method), the SDK assumes protocol `1.0`.

## Compatibility matrix

| SDK version | Bundle MAJOR supported |
| ----------- | ---------------------- |
| 0.x         | 1                      |

## Framework-specific examples

See [`doc/examples/angular/`](https://github.com/DataLab-Platform/web/tree/main/doc/examples/angular) in the DataLab-Web repository for an Angular integration template (service + component) that wraps this SDK.

## License

BSD 3-Clause, same as DataLab and Sigima.
