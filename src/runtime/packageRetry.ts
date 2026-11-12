/**
 * Bounded retries of the Python package installation of a Pyodide instance
 * (main runtime, kernel, macro and notebook workers).
 *
 * On a cold browser cache, several Pyodide instances download the same
 * packages at once; a download may then fail transiently (e.g. a cache
 * write failure in Chrome). ``pyodide.loadPackage`` does not throw on such
 * a failure — it reports it through its ``errorCallback`` and the package
 * stays missing — and ``micropip.install`` raises. Both are retried here a
 * few times, with a growing delay, so that a transient failure does not
 * leave a worker without its Python stack. Each failure is logged.
 * :func:`loadPyodideOrFail` turns the hang of Pyodide itself, when its
 * WebAssembly module fails to load, into an error.
 */

/** The part of the Pyodide API used here. */
export interface PackageLoader {
  loadPackage(
    names: string | string[],
    options?: {
      messageCallback?: (message: string) => void;
      errorCallback?: (message: string) => void;
      checkIntegrity?: boolean;
    },
  ): Promise<unknown>;
  runPythonAsync(code: string): Promise<unknown>;
}

export interface RetryOptions {
  /** Attempts in all (default 3). */
  attempts?: number;
  /** Delay before the second attempt, doubled for each next one
   *  (default 2 s). */
  delayMs?: number;
  /** Prefix of the log messages (e.g. ``"[macro worker]"``). */
  label?: string;
  /** Waits between attempts (tests replace it). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 2000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run ``attempt`` until it succeeds, at most ``options.attempts`` times;
 *  rethrow the last error. */
async function withRetry(
  what: string,
  attempt: () => Promise<void>,
  options: RetryOptions,
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  const label = options.label ?? "[python]";
  let delay = options.delayMs ?? DEFAULT_DELAY_MS;
  for (let n = 1; ; n++) {
    try {
      await attempt();
      if (n > 1) console.info(`${label} ${what}: succeeded at attempt ${n}`);
      return;
    } catch (error) {
      if (n >= attempts) {
        console.error(`${label} ${what}: failed after ${n} attempts`, error);
        throw error;
      }
      console.warn(
        `${label} ${what}: attempt ${n} failed (${message(error)}); ` +
          `retrying in ${delay} ms`,
      );
      await sleep(delay);
      delay *= 2;
    }
  }
}

/** ``py.loadPackage(names)``, retried while some package fails to load
 *  (packages already loaded are skipped by Pyodide on the next attempt).
 *  As ``loadPackage`` itself, never throws: a package still missing after
 *  the last attempt is logged, and surfaces when it is imported. */
export async function loadPackagesWithRetry(
  py: PackageLoader,
  names: string[],
  options: RetryOptions = {},
): Promise<void> {
  try {
    await withRetry(
      `loading ${names.join(", ")}`,
      async () => {
        const errors: string[] = [];
        await py.loadPackage(names, {
          errorCallback: (text) => errors.push(text),
          checkIntegrity: true,
        });
        if (errors.length > 0) throw new Error(errors.join(" "));
      },
      options,
    );
  } catch {
    // Already logged by ``withRetry``.
  }
}

/** ``await micropip.install(requirements)``, retried on failure
 *  (``micropip`` must be loaded). */
export function micropipInstallWithRetry(
  py: PackageLoader,
  requirements: string[],
  options: RetryOptions = {},
): Promise<void> {
  return withRetry(
    `installing ${requirements.join(", ")}`,
    async () => {
      await py.runPythonAsync(
        `import micropip\nawait micropip.install(${JSON.stringify(requirements)})`,
      );
    },
    options,
  );
}

/**
 * ``load(options)`` (Pyodide's ``loadPyodide``), failing when the
 * WebAssembly module of Pyodide cannot be loaded. Pyodide then only logs
 * "wasm instantiation failed!" and never settles — seen when several
 * Pyodide instances fetch the module at once on a cold cache, or when a
 * worker fetching it is terminated meanwhile —, which left a worker loading
 * forever: its caller can now report the failure and start afresh.
 */
export async function loadPyodideOrFail<T, O>(
  load: (options: O) => Promise<T>,
  options: O,
): Promise<T> {
  const warn = console.warn;
  let fail: (error: Error) => void = () => undefined;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  console.warn = (...args: unknown[]) => {
    warn.apply(console, args);
    if (
      args.some(
        (arg) =>
          typeof arg === "string" && arg.includes("wasm instantiation failed"),
      )
    ) {
      fail(new Error("the WebAssembly module of Pyodide could not be loaded"));
    }
  };
  try {
    return await Promise.race([load(options), failed]);
  } finally {
    console.warn = warn;
  }
}
