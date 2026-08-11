/** Persistent OPFS store for user-installed DataLab-Web plugin wheels. */

export const PLUGIN_WHEEL_STORE_DIR = "dlw-plugin-wheels";
const INDEX_FILE = "index.json";
const NEXT_INDEX_FILE = "index.next.json";
const SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface UserPluginWheelRecord {
  artifactId: string;
  sha256: string;
  filename: string;
  sizeBytes: number;
  distribution: string;
  version: string;
  pluginIds: string[];
  enabledPluginIds: string[];
  installedAt: string;
}

interface PluginWheelIndex {
  schemaVersion: typeof SCHEMA_VERSION;
  generation: number;
  artifacts: UserPluginWheelRecord[];
}

export interface StoredPluginWheel {
  metadata: UserPluginWheelRecord;
  bytes: Uint8Array;
}

function emptyIndex(): PluginWheelIndex {
  return { schemaVersion: SCHEMA_VERSION, generation: 0, artifacts: [] };
}

function archiveName(sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(
      "Plugin wheel SHA-256 must be 64 lowercase hexadecimal digits",
    );
  }
  return `${sha256}.whl`;
}

function validateRecord(value: unknown): value is UserPluginWheelRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<UserPluginWheelRecord>;
  return (
    typeof record.artifactId === "string" &&
    record.artifactId === `sha256:${record.sha256}` &&
    typeof record.sha256 === "string" &&
    SHA256_PATTERN.test(record.sha256) &&
    typeof record.filename === "string" &&
    record.filename.toLowerCase().endsWith(".whl") &&
    typeof record.sizeBytes === "number" &&
    Number.isSafeInteger(record.sizeBytes) &&
    record.sizeBytes >= 0 &&
    typeof record.distribution === "string" &&
    typeof record.version === "string" &&
    Array.isArray(record.pluginIds) &&
    record.pluginIds.every((item) => typeof item === "string") &&
    Array.isArray(record.enabledPluginIds) &&
    record.enabledPluginIds.every((item) => typeof item === "string") &&
    typeof record.installedAt === "string"
  );
}

function parseIndex(text: string): PluginWheelIndex | null {
  try {
    const value = JSON.parse(text) as Partial<PluginWheelIndex>;
    if (
      value.schemaVersion !== SCHEMA_VERSION ||
      typeof value.generation !== "number" ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 0 ||
      !Array.isArray(value.artifacts) ||
      !value.artifacts.every(validateRecord)
    ) {
      return null;
    }
    return value as PluginWheelIndex;
  } catch {
    return null;
  }
}

/**
 * OPFS owner for user plugin wheel bytes and their committed metadata.
 *
 * The directory is deliberately distinct from `dlw-object-store`, whose
 * workspace clear operation must never remove installed plugins.
 */
export class PluginWheelStore {
  private dir: FileSystemDirectoryHandle | null = null;
  private index: PluginWheelIndex = emptyIndex();
  private initialised = false;

  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof globalThis.isSecureContext === "boolean" &&
      globalThis.isSecureContext
    );
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    if (!PluginWheelStore.isSupported()) {
      throw new Error("Persistent plugin storage requires OPFS");
    }
    const root = await navigator.storage.getDirectory();
    this.dir = await root.getDirectoryHandle(PLUGIN_WHEEL_STORE_DIR, {
      create: true,
    });
    const committed = await this.readIndex(INDEX_FILE);
    const pending = await this.readIndex(NEXT_INDEX_FILE);
    this.index =
      [committed, pending]
        .filter((item): item is PluginWheelIndex => item !== null)
        .sort((left, right) => right.generation - left.generation)[0] ??
      emptyIndex();
    if (pending && pending.generation >= (committed?.generation ?? -1)) {
      await this.writeRaw(INDEX_FILE, JSON.stringify(this.index));
    }
    await this.removeEntry(NEXT_INDEX_FILE);
    this.initialised = true;
  }

  private requireDir(): FileSystemDirectoryHandle {
    if (!this.dir)
      throw new Error("PluginWheelStore.init() must be called first");
    return this.dir;
  }

  private async readIndex(name: string): Promise<PluginWheelIndex | null> {
    try {
      const handle = await this.requireDir().getFileHandle(name);
      return parseIndex(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  }

  private async writeRaw(
    name: string,
    value: string | Uint8Array,
  ): Promise<void> {
    const handle = await this.requireDir().getFileHandle(name, {
      create: true,
    });
    const writable = await handle.createWritable();
    try {
      const data =
        typeof value === "string"
          ? value
          : ((value.byteOffset === 0 &&
            value.byteLength === value.buffer.byteLength
              ? value.buffer
              : value.slice().buffer) as ArrayBuffer);
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  private async removeEntry(name: string): Promise<void> {
    try {
      await this.requireDir().removeEntry(name);
    } catch {
      // Missing entries are already in the desired state.
    }
  }

  private async writeIndex(artifacts: UserPluginWheelRecord[]): Promise<void> {
    const next: PluginWheelIndex = {
      schemaVersion: SCHEMA_VERSION,
      generation: this.index.generation + 1,
      artifacts,
    };
    const serialized = JSON.stringify(next);
    await this.writeRaw(NEXT_INDEX_FILE, serialized);
    await this.writeRaw(INDEX_FILE, serialized);
    this.index = next;
    await this.removeEntry(NEXT_INDEX_FILE);
  }

  /** Persist uncommitted bytes before attempting runtime import. */
  async stage(sha256: string, bytes: Uint8Array): Promise<void> {
    if (this.index.artifacts.some((item) => item.sha256 === sha256)) {
      throw new Error(`Plugin wheel sha256:${sha256} is already installed`);
    }
    await this.writeRaw(archiveName(sha256), bytes);
  }

  /** Publish metadata after every Web entry point registered successfully. */
  async commit(record: UserPluginWheelRecord): Promise<void> {
    if (!validateRecord(record))
      throw new Error("Invalid plugin wheel metadata");
    const bytes = await this.readBytes(record.sha256);
    if (bytes.byteLength !== record.sizeBytes) {
      throw new Error("Staged plugin wheel size does not match its metadata");
    }
    const artifacts = this.index.artifacts.filter(
      (item) => item.artifactId !== record.artifactId,
    );
    artifacts.push({
      ...record,
      pluginIds: [...record.pluginIds],
      enabledPluginIds: [...record.enabledPluginIds],
    });
    await this.writeIndex(artifacts);
  }

  /** Remove bytes left by an import or metadata-commit failure. */
  async rollback(sha256: string): Promise<void> {
    if (this.index.artifacts.some((item) => item.sha256 === sha256)) return;
    await this.removeEntry(archiveName(sha256));
  }

  list(): UserPluginWheelRecord[] {
    return this.index.artifacts.map((record) => ({
      ...record,
      pluginIds: [...record.pluginIds],
      enabledPluginIds: [...record.enabledPluginIds],
    }));
  }

  async readBytes(sha256: string): Promise<Uint8Array> {
    const handle = await this.requireDir().getFileHandle(archiveName(sha256));
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async listStored(): Promise<StoredPluginWheel[]> {
    return Promise.all(
      this.list().map(async (metadata) => ({
        metadata,
        bytes: await this.readBytes(metadata.sha256),
      })),
    );
  }

  async setEnabledPluginIds(
    artifactId: string,
    enabledPluginIds: readonly string[],
  ): Promise<void> {
    const artifacts = this.list();
    const record = artifacts.find((item) => item.artifactId === artifactId);
    if (!record)
      throw new Error(`Unknown plugin wheel artifact: ${artifactId}`);
    const known = new Set(record.pluginIds);
    if (enabledPluginIds.some((pluginId) => !known.has(pluginId))) {
      throw new Error("Enabled plugin IDs must belong to the wheel artifact");
    }
    record.enabledPluginIds = [...enabledPluginIds];
    await this.writeIndex(artifacts);
  }

  async remove(artifactId: string): Promise<void> {
    const record = this.index.artifacts.find(
      (item) => item.artifactId === artifactId,
    );
    if (!record) return;
    await this.writeIndex(
      this.index.artifacts.filter((item) => item.artifactId !== artifactId),
    );
    await this.removeEntry(archiveName(record.sha256));
  }
}
