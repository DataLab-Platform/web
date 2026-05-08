/**
 * Public entry point of the DataLab-Web client SDK.
 *
 * Re-exports the host-side helpers used to drive a DataLab-Web iframe
 * over ``window.postMessage``. This file is the only module name
 * consumers should import from (``@datalab-platform/web-sdk``); the
 * concrete file layout under ``src/`` is an implementation detail.
 */

export {
  DataLabWebClient,
  DataLabWebRemoteError,
  SUPPORTED_PROTOCOL_MAJOR,
} from "./DataLabWebClient";

export type {
  DataLabWebClientOptions,
  DataLabWebRpcError,
  ImageData2D,
  SignalXY,
} from "./DataLabWebClient";
