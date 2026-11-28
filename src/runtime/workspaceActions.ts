import type { RemoteFile } from "./remoteFiles";

type OpenWorkspaceAction = (file: RemoteFile) => Promise<string[]>;

let openAction: OpenWorkspaceAction | null = null;
let statusAction: (() => WorkspaceStatus) | null = null;
const statusListeners = new Set<(status: WorkspaceStatus) => void>();

export interface WorkspaceStatus {
  dirty: boolean;
}

export function registerOpenWorkspaceAction(
  action: OpenWorkspaceAction | null,
): void {
  openAction = action;
}

export async function openWorkspaceFile(file: RemoteFile): Promise<string[]> {
  if (!openAction) throw new Error("The DataLab workspace UI is not ready.");
  return openAction(file);
}

export function registerWorkspaceStatusAction(
  action: (() => WorkspaceStatus) | null,
): void {
  statusAction = action;
}

export function getWorkspaceStatus(): WorkspaceStatus {
  if (!statusAction) throw new Error("The DataLab workspace UI is not ready.");
  return statusAction();
}

export function publishWorkspaceStatus(status: WorkspaceStatus): void {
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (error) {
      console.warn("[workspace] status listener failed", error);
    }
  }
}

export function subscribeWorkspaceStatus(
  listener: (status: WorkspaceStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
