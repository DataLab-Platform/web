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
and SHA-256 in `src/runtime/bundledCamera.ts` or
`src/runtime/bundledPulse.ts`. Run the focused TypeScript, Python, and
Playwright bundle contracts after every replacement. The TypeScript tests fail
if a committed artifact and manifest drift.
