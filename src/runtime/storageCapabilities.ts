import { OpfsObjectStore } from "../storage/opfsObjectStore";

/** Whether the browser exposes the OPFS APIs required by disk storage. */
export function isDiskStorageSupported(): boolean {
  return OpfsObjectStore.isSupported();
}
