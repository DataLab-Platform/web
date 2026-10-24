/**
 * Per-session directories of the on-disk object stores.
 *
 * Several DataLab-Web sessions (tabs, windows) of the same origin share one
 * OPFS. Each object store therefore keeps its files in its own session
 * directory, owned through an exclusive Web Lock held for the lifetime of the
 * page (or worker): clearing a store only removes its own directory, and the
 * directories of sessions that ended without cleaning up (closed tab, crash)
 * are removed by the next session that opens a store, once their lock is
 * free. Without the Web Locks API, abandoned directories are left in place:
 * nothing tells them apart from those of running sessions.
 */

/** Parent of the session directories, under the OPFS root. Distinct from the
 *  shared directory of earlier versions (``dlw-object-store``), which an
 *  earlier version still open in another tab may clear at any time. */
export const SESSIONS_DIR = "dlw-object-sessions";

/** Prefix of the Web Lock owning a session directory. */
export const SESSION_LOCK_PREFIX = "dlw-object-session:";

/** Subset of the Web Locks API used here. */
interface LockManagerLike {
  request(
    name: string,
    options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

/** Directory handle able to list its entries. */
type ListableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

/** Session directory of an object store. */
export interface SessionDirectory {
  /** Parent of all session directories. */
  parent: FileSystemDirectoryHandle;
  /** Name of the session directory in *parent*. */
  name: string;
  /** The session directory. */
  dir: FileSystemDirectoryHandle;
}

function lockManager(): LockManagerLike | null {
  const locks = (
    globalThis.navigator as { locks?: Partial<LockManagerLike> } | undefined
  )?.locks;
  return locks && typeof locks.request === "function"
    ? (locks as LockManagerLike)
    : null;
}

function newSessionName(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoApi?.randomUUID === "function")
    return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Acquire the exclusive lock *name* and hold it until the page or worker
 *  ends (the browser then releases it). Resolves once the lock is held. */
function holdLock(locks: LockManagerLike, name: string): Promise<void> {
  return new Promise((acquired, failed) => {
    locks
      .request(name, { mode: "exclusive" }, () => {
        acquired();
        return new Promise<never>(() => {});
      })
      .catch(failed);
  });
}

/** Remove the session directories of *parent* whose lock is free, i.e. whose
 *  session has ended (all but *own*). Failures are ignored: they only delay
 *  the reclaim of disk space. */
async function removeAbandonedSessions(
  parent: FileSystemDirectoryHandle,
  own: string,
  locks: LockManagerLike,
): Promise<void> {
  const names: string[] = [];
  try {
    for await (const entry of (parent as ListableDirectory).values()) {
      if (entry.kind === "directory" && entry.name !== own) {
        names.push(entry.name);
      }
    }
  } catch {
    return;
  }
  for (const name of names) {
    try {
      await locks.request(
        SESSION_LOCK_PREFIX + name,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock === null) return; // The session is running
          await parent.removeEntry(name, { recursive: true });
        },
      );
    } catch {
      // Ignored (see above)
    }
  }
}

/**
 * Create the directory of a new session under *root*, and remove those of
 * the sessions that have ended.
 *
 * The lock of the new session is acquired before its directory is created,
 * so that another session never takes it for an abandoned one.
 */
export async function openSessionDirectory(
  root: FileSystemDirectoryHandle,
): Promise<SessionDirectory> {
  const parent = await root.getDirectoryHandle(SESSIONS_DIR, { create: true });
  const name = newSessionName();
  const locks = lockManager();
  if (locks) {
    await holdLock(locks, SESSION_LOCK_PREFIX + name);
    await removeAbandonedSessions(parent, name, locks);
  }
  const dir = await parent.getDirectoryHandle(name, { create: true });
  return { parent, name, dir };
}

/** Empty the directory of *session* and return its new handle. */
export async function resetSessionDirectory(
  session: SessionDirectory,
): Promise<FileSystemDirectoryHandle> {
  try {
    await session.parent.removeEntry(session.name, { recursive: true });
  } catch {
    // Directory may not exist anymore.
  }
  session.dir = await session.parent.getDirectoryHandle(session.name, {
    create: true,
  });
  return session.dir;
}
