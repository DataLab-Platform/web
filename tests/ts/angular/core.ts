import { vi } from "vitest";

const providers = new Map<unknown, unknown>();

export function provide(token: unknown, value: unknown): void {
  providers.set(token, value);
}

export function inject(token: unknown): unknown {
  if (!providers.has(token)) throw new Error("Missing test provider");
  return providers.get(token);
}

export function signal<T>(initial: T) {
  let value = initial;
  const read = () => value;
  read.set = (next: T) => {
    value = next;
  };
  return read;
}

export class EventEmitter<T> {
  emit = vi.fn<(value: T) => void>();
}

export const ChangeDetectionStrategy = { OnPush: 0 };
export const Component = () => () => {};
export const Injectable = () => () => {};
export const Input = () => () => {};
export const Output = () => () => {};
export const ViewChild = () => () => {};
