# Bundled Python wheels

This directory contains pure-Python distributions that are part of the
DataLab-Web build. They are explicit application assets, not a general wheel
installer: Pyodide never searches a public package index for them or resolves
their Desktop dependencies.

The Camera and Pulse wheels are built from their sibling plugin checkouts:

```powershell
python -m build --wheel --outdir <output-directory>
```

Copy the resulting artifact here, then update its filename, version, byte size,
and SHA-256 in `src/runtime/bundledPlugins.ts`. Run the focused TypeScript,
Python, and Playwright application contracts after every replacement. The
TypeScript tests fail if a committed artifact and the integrity catalog drift.

Every artifact is inspected through the same `dlw_wheels.py` path as a local
user wheel and must expose at least one `datalab.web_plugins` entry point. The
catalog contains build integrity only; plugin identity, capabilities, recipes,
examples, and documentation come from the loaded portable plugin class.
