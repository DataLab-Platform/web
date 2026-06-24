/**
 * Bundled example plugins (DataLab-Web).
 *
 * The Python sources live in the repo-root ``plugins/examples/`` folder,
 * mirroring DataLab desktop's ``plugins/examples/``. They are bundled at
 * build time via Vite's ``import.meta.glob`` and offered for *on-demand*
 * loading from the Plugin Manager — unlike ``src/runtime/builtin_plugins/``,
 * whose modules are discovered and loaded automatically at startup.
 */

export interface ExamplePlugin {
  /** Base file name, e.g. ``datalab_example_empty.py``. */
  filename: string;
  /** Raw Python source. */
  source: string;
}

// Path is relative to this module (``src/plugins/``); ``plugins/examples/``
// sits at the repository root, hence the ``../../`` prefix.
const modules = import.meta.glob("../../plugins/examples/*.py", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Example plugins bundled with the app, sorted by file name. */
export const EXAMPLE_PLUGINS: ExamplePlugin[] = Object.entries(modules)
  .map(([path, source]) => ({
    filename: path.split("/").pop() ?? "plugin.py",
    source,
  }))
  .sort((a, b) => a.filename.localeCompare(b.filename));
