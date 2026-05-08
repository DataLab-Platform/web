# @datalab-platform/web-sdk

Host-side TypeScript SDK to embed and control [DataLab-Web](https://github.com/DataLab-Platform/DataLab-Web) — the Pyodide-based browser version of [DataLab](https://github.com/DataLab-Platform/DataLab) — from any web application.

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

## Wire-protocol versioning

`client.ready()` negotiates a wire-protocol version with the iframe (semver `MAJOR.MINOR`). It rejects if the iframe reports a MAJOR incompatible with the SDK (`SUPPORTED_PROTOCOL_MAJOR`).

| Bump | Trigger |
| ---- | ------- |
| MAJOR | breaking change to message shape or method semantics |
| MINOR | backwards-compatible additions (new methods, optional fields) |

If the iframe predates protocol versioning (no `get_protocol_version` method), the SDK assumes protocol `1.0`.

## Compatibility matrix

| SDK version | Bundle MAJOR supported |
| ----------- | ---------------------- |
| 0.x         | 1                      |

## Framework-specific examples

See [`doc/examples/angular/`](https://github.com/DataLab-Platform/DataLab-Web/tree/main/doc/examples/angular) in the DataLab-Web repository for an Angular integration template (service + component) that wraps this SDK.

## License

BSD 3-Clause, same as DataLab and Sigima.
