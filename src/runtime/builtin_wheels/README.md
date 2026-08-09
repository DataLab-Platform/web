# Bundled Python wheels

This directory contains pure-Python distributions that are part of the
DataLab-Web build. They are explicit application assets, not a general wheel
installer: Pyodide never searches a public package index for them or resolves
their Desktop dependencies.

The Camera wheel is built from the sibling
`datalab-camera-characterization` checkout:

```powershell
python -m build --wheel --outdir ..\DataLab-Web\src\runtime\builtin_wheels
```

After replacing an artifact, update its filename, version, byte size, and
SHA-256 in `src/runtime/bundledCamera.ts`. Then run the focused TypeScript,
Python, and Playwright bundle contracts. The TypeScript test fails if the
committed artifact and manifest drift.
