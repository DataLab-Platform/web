/**
 * Per-plugin trust store backed by localStorage.
 *
 * Plugins can ship arbitrary Python code; before the first load of any
 * unknown plugin we ask the user for explicit consent. The choice is
 * remembered across sessions, scoped to the workspace origin, and keyed
 * by a stable plugin identifier (filename + SHA-256 of the source).
 */

const STORAGE_KEY = "datalab-web/trusted-plugins";

export interface TrustEntry {
  filename: string;
  hash: string;
  trustedAt: string;
}

function read(): TrustEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as TrustEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: TrustEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota errors are non-fatal: trust just won't persist.
  }
}

export async function hashSource(source: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(source));
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  const digestBytes = Array.from(new Uint8Array(digest));
  return digestBytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isPluginHashTrusted(filename: string, hash: string): boolean {
  return read().some(
    (entry) => entry.filename === filename && entry.hash === hash,
  );
}

export function trustPluginHash(filename: string, hash: string): void {
  const entries = read().filter(
    (entry) => !(entry.filename === filename && entry.hash === hash),
  );
  entries.push({ filename, hash, trustedAt: new Date().toISOString() });
  write(entries);
}

export async function isPluginTrusted(
  filename: string,
  source: string,
): Promise<boolean> {
  const hash = await hashSource(source);
  return isPluginHashTrusted(filename, hash);
}

export async function trustPlugin(
  filename: string,
  source: string,
): Promise<void> {
  const hash = await hashSource(source);
  trustPluginHash(filename, hash);
}

export function listTrustedPlugins(): TrustEntry[] {
  return read();
}

export function revokePluginTrust(filename: string, hash: string): void {
  const entries = read().filter(
    (e) => !(e.filename === filename && e.hash === hash),
  );
  write(entries);
}
