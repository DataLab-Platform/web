export const RUNTIME_CONFIG_SCHEMA_VERSION = 1 as const;

export type RuntimeDistribution = "cdn" | "local";
export type RuntimeKind = "main" | "macro" | "notebook";

export interface PythonWheelConfig {
  name: string;
  version: string;
  url: string;
  sha256: string;
}

export interface RuntimeConfig {
  schemaVersion: typeof RUNTIME_CONFIG_SCHEMA_VERSION;
  distribution: RuntimeDistribution;
  pyodideVersion: string;
  pyodideIndexUrl: string;
  pyodidePackages: Record<RuntimeKind, string[]>;
  pythonWheels: PythonWheelConfig[];
  allowPublicNetwork: boolean;
}

export interface ResolvedPythonWheelConfig extends Omit<
  PythonWheelConfig,
  "url"
> {
  url: string;
}

export interface ResolvedRuntimeConfig extends Omit<
  RuntimeConfig,
  "pyodideIndexUrl" | "pythonWheels"
> {
  configUrl: string;
  deploymentRootUrl: string;
  pyodideIndexUrl: string;
  pyodideModuleUrl: string;
  pythonWheels: ResolvedPythonWheelConfig[];
}

export type PyodideModuleImporter = (url: string) => Promise<{
  loadPyodide?: (options: { indexURL: string }) => Promise<unknown>;
}>;

function configError(message: string): Error {
  return new Error(`Invalid runtime configuration: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  field: string,
  pattern?: RegExp,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw configError(`${field} must be a non-empty string`);
  }
  if (pattern && !pattern.test(value)) {
    throw configError(`${field} has an invalid value`);
  }
  return value;
}

function parsePackageList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw configError(`${field} must be a non-empty array`);
  }
  const packages = value.map((entry, index) =>
    requireString(entry, `${field}[${index}]`, /^[A-Za-z0-9_.-]+$/),
  );
  if (new Set(packages).size !== packages.length) {
    throw configError(`${field} contains duplicate packages`);
  }
  return packages;
}

function parseWheel(value: unknown, index: number): PythonWheelConfig {
  const field = `pythonWheels[${index}]`;
  if (!isRecord(value)) {
    throw configError(`${field} must be an object`);
  }
  return {
    name: requireString(value.name, `${field}.name`, /^[A-Za-z0-9_.-]+$/),
    version: requireString(
      value.version,
      `${field}.version`,
      /^[A-Za-z0-9][A-Za-z0-9_.+!-]*$/,
    ),
    url: requireString(value.url, `${field}.url`),
    sha256: requireString(value.sha256, `${field}.sha256`, /^[a-f0-9]{64}$/),
  };
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!isRecord(value)) {
    throw configError("root value must be an object");
  }
  if (value.schemaVersion !== RUNTIME_CONFIG_SCHEMA_VERSION) {
    throw configError(`schemaVersion must be ${RUNTIME_CONFIG_SCHEMA_VERSION}`);
  }
  if (value.distribution !== "cdn" && value.distribution !== "local") {
    throw configError('distribution must be "cdn" or "local"');
  }
  if (typeof value.allowPublicNetwork !== "boolean") {
    throw configError("allowPublicNetwork must be a boolean");
  }
  if (value.distribution === "local" && value.allowPublicNetwork) {
    throw configError("local distributions cannot allow public network access");
  }
  if (!isRecord(value.pyodidePackages)) {
    throw configError("pyodidePackages must be an object");
  }
  if (!Array.isArray(value.pythonWheels) || value.pythonWheels.length === 0) {
    throw configError("pythonWheels must be a non-empty array");
  }

  const pythonWheels = value.pythonWheels.map(parseWheel);
  const wheelNames = pythonWheels.map(({ name }) => name.toLowerCase());
  if (new Set(wheelNames).size !== wheelNames.length) {
    throw configError("pythonWheels contains duplicate package names");
  }

  return {
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    distribution: value.distribution,
    pyodideVersion: requireString(
      value.pyodideVersion,
      "pyodideVersion",
      /^\d+\.\d+\.\d+$/,
    ),
    pyodideIndexUrl: requireString(value.pyodideIndexUrl, "pyodideIndexUrl"),
    pyodidePackages: {
      main: parsePackageList(
        value.pyodidePackages.main,
        "pyodidePackages.main",
      ),
      macro: parsePackageList(
        value.pyodidePackages.macro,
        "pyodidePackages.macro",
      ),
      notebook: parsePackageList(
        value.pyodidePackages.notebook,
        "pyodidePackages.notebook",
      ),
    },
    pythonWheels,
    allowPublicNetwork: value.allowPublicNetwork,
  };
}

function resolveLocalAsset(
  path: string,
  deploymentRootUrl: URL,
  field: string,
): string {
  const resolved = new URL(path, deploymentRootUrl);
  if (
    resolved.origin !== deploymentRootUrl.origin ||
    !resolved.pathname.startsWith(deploymentRootUrl.pathname)
  ) {
    throw configError(`${field} must stay inside the deployment root`);
  }
  return resolved.href;
}

export function resolveRuntimeConfig(
  value: unknown,
  configUrl: string,
): ResolvedRuntimeConfig {
  const config = parseRuntimeConfig(value);
  const absoluteConfigUrl = new URL(configUrl);
  const deploymentRootUrl = new URL("./", absoluteConfigUrl);
  const resolveAsset = (path: string, field: string): string => {
    const resolved = new URL(path, deploymentRootUrl);
    if (config.distribution === "local") {
      return resolveLocalAsset(path, deploymentRootUrl, field);
    }
    if (
      !config.allowPublicNetwork &&
      resolved.origin !== deploymentRootUrl.origin
    ) {
      throw configError(`${field} requires public network access`);
    }
    return resolved.href;
  };
  const pyodideIndexUrl = resolveAsset(
    config.pyodideIndexUrl,
    "pyodideIndexUrl",
  );

  return {
    ...config,
    configUrl: absoluteConfigUrl.href,
    deploymentRootUrl: deploymentRootUrl.href,
    pyodideIndexUrl,
    pyodideModuleUrl: new URL("pyodide.mjs", pyodideIndexUrl).href,
    pythonWheels: config.pythonWheels.map((wheel, index) => ({
      ...wheel,
      url: resolveAsset(wheel.url, `pythonWheels[${index}].url`),
    })),
  };
}

export async function loadConfiguredPyodide(
  config: ResolvedRuntimeConfig,
  importer: PyodideModuleImporter = (url) =>
    import(/* @vite-ignore */ url) as Promise<{
      loadPyodide?: (options: { indexURL: string }) => Promise<unknown>;
    }>,
): Promise<unknown> {
  try {
    const module = await importer(config.pyodideModuleUrl);
    if (typeof module.loadPyodide !== "function") {
      throw new Error("module does not export loadPyodide");
    }
    return await module.loadPyodide({ indexURL: config.pyodideIndexUrl });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load Pyodide ${config.pyodideVersion} for the ` +
        `${config.distribution} distribution from ${config.pyodideModuleUrl}: ` +
        `${detail}. See DEPLOY.md for server requirements.`,
      { cause: error },
    );
  }
}

export function pythonWheelInstallCode(config: ResolvedRuntimeConfig): string {
  const wheelUrls = config.pythonWheels.map(({ url }) => url);
  return `
import micropip
await micropip.install(${JSON.stringify(wheelUrls)}, deps=${
    config.allowPublicNetwork ? "True" : "False"
  })
`;
}

let runtimeConfigPromise: Promise<ResolvedRuntimeConfig> | null = null;

export function loadRuntimeConfig(
  documentBaseUrl: string = document.baseURI,
  fetcher: typeof fetch = fetch,
): Promise<ResolvedRuntimeConfig> {
  if (!runtimeConfigPromise) {
    const configUrl = new URL("runtime-config.json", documentBaseUrl).href;
    runtimeConfigPromise = fetcher(configUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Unable to load runtime configuration from ${configUrl} ` +
            `(HTTP ${response.status})`,
        );
      }
      return resolveRuntimeConfig(await response.json(), configUrl);
    });
  }
  return runtimeConfigPromise;
}

export function resetRuntimeConfigForTests(): void {
  runtimeConfigPromise = null;
}
