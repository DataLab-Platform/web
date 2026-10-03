/// <reference types="vite/client" />

declare module "*.svg" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  /** Application version, injected at build time from ``package.json``
   *  (see ``vite.config.ts``). */
  readonly VITE_APP_VERSION: string;
  /** Optional DataLab-Capsule wheel or requirement for development builds. */
  readonly VITE_DATALAB_CAPSULE_INSTALL_SPEC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
