# J1 WASM64 environment preflight

**Scientific worker tested, not an application deployment (2026-11-25).** The unmodified WASM64 extension reports `kiwisolver.__version__ == "1.5.1"`; only its Python packaging metadata reports `0.0.0`. Chromium 156.0.8078.4 solved `x+y=12`, `x-y=2` as `(7,5)`. Matplotlib 3.11.2 imported with its own version check intact. The full worker then ran a Sigima Gaussian filter with a guidata dialog round trip and wrote and reread the result using h5py.

## Reproduce

Run inside `tools/wasm64`, not at the repository root. The npm lock pins `@derthorsten/pyjs@5.2.0` and its registry integrity. The Python and `curl` executables are build-host tools only. Tested on Windows x64 with Node 22.23.4, npm 10.9.9 and CPython 3.12.13.

```powershell
npm ci --ignore-scripts --no-fund --no-audit
uv venv .venv --python 3.12
uv pip install --python .venv\Scripts\python.exe --only-binary :all: -r requirements-maintenance.txt
.\.venv\Scripts\python.exe build.py --allow-kiwi-metadata
```

On Linux use `.venv/bin/python`. `build.py` consumes `environment.lock.json` (31 conda archives, 10 pure wheels and the embedded pyjs environment); it does not run the solver. Add `--offline` to build from a populated `.cache/mirror`. From the repository root with the Playwright prerequisites installed, run `node tests/wasm64/qualify-worker.mjs` to exercise the served result.

**Maintenance only:** `resolve.py --allow-kiwi-metadata` refreshes target metadata and regenerates the lock. It reads application manifests, applies Emscripten markers, pins all five embedded packages, and uses only the small 6x indexes and selected conda-forge `noarch` shards. Neither command enables the exception by default: the strict solve and the strict rebuild of this lock both refuse the mismatch.

The exception in `kiwi_workaround.py` is restricted to the archive below and its SHA-256. The lock records the reported and checked versions separately. No `.dist-info`, binary or runtime API is rewritten. Code that queries `importlib.metadata.version("kiwisolver")` still sees `0.0.0`; this is not a general fix for installing packages at runtime.

## Why another build cannot satisfy this constraint today

- Sigima 1.4.1's wheel requires `scikit-image>=0.19.2,<0.27`. Both 6x WASM64 candidates are 0.26.0 (`np25py314h85a2628_0`, `_1`); both require `matplotlib-base>=3.0.3`.
- Both `matplotlib-base` candidates are 3.11.2 (`np25py314h5eb9d72_0`, `np25py314h3134dbf_1`). The `.dist-info/METADATA` **inside both artifacts** contains `Requires-Dist: kiwisolver>=1.3.1`. A conda solver sees only the unversioned `kiwisolver` dependency.
- The [sole kiwisolver artifact](https://repo.prefix.dev/emscripten-forge/6x/emscripten-wasm64/kiwisolver-1.5.1-py314hd0a4d62_0.tar.bz2) is 42,460 bytes, SHA-256 `1515fc7ff9637422d222eb2ae2c4eb91dfc3b6e598a894ad7e9d210ec73ceac8`. It contains `_cext.cpython-314-wasm64-emscripten.so`, but its `kiwisolver-0.0.0.dist-info/METADATA` declares `Version: 0.0.0`. Correct architecture does not resolve the version mismatch. No host wheel, wasm32 package, edited metadata or omitted conda dependency was used.

To inspect the decisive bytes independently after running the preflight:

```sh
tar -xOf .cache/mirror/kiwisolver-1.5.1-py314hd0a4d62_0.tar.bz2 lib/python3.14/site-packages/kiwisolver-0.0.0.dist-info/METADATA
tar -xOf .cache/mirror/matplotlib-base-3.11.2-np25py314h3134dbf_1.tar.bz2 lib/python3.14/site-packages/matplotlib-3.11.2.dist-info/METADATA
```

The [WASM64 index](https://repo.prefix.dev/emscripten-forge/6x/emscripten-wasm64/repodata.json) checked was 1,076,886 bytes, SHA-256 `d246d8bad9bf5935a587a4f6e81b2751522cbdbE3ff9f55c4e64c3f4ee30898e`. The embedded target is `python 3.14.3 h_4b70090_8_cp314`, `python_abi 3.14 9_cp314`, `emscripten-abi 6.0.8 h267e887_3`. The exact package versions and hashes are in [the lock](./environment.lock.json).

**Removal criterion** ([DataLab-Platform/web#139](https://github.com/DataLab-Platform/web/issues/139)): when a corrected 6x artifact is available or the dependency is no longer needed, rerun `resolve.py` and `build.py` without the flag and replay the browser probe. Remove the exception and its flag after all three pass. No changes are needed in the stable application.

### Why native pip does not pull matplotlib

The [scikit-image 0.26.0 Python distribution](https://pypi.org/pypi/scikit-image/0.26.0/json) declares matplotlib only under extras (`docs`, `optional-free-threaded`). By contrast the [Emscripten Forge scikit-image recipe](https://github.com/emscripten-forge/recipes/blob/e12a841b529bb47ae4288997057d5a1da0fafc18/recipes/recipes_emscripten/scikit-image/recipe.yaml#L32-L41) lists `matplotlib-base >=3.0.3` under **run**, not test or extras. Re-solving the cached indexes with just `scikit-image >=0.19.2,<0.27` plus pyjs's embedded pins selected `scikit-image-0.26.0-np25py314h85a2628_1`, `matplotlib-base-3.11.2-np25py314h3134dbf_1` and `kiwisolver-1.5.1-py314hd0a4d62_0`. No other scientific root was needed to reproduce the chain.

No published substitution was found in the checked sources. The non-yanked in-range wheels on the PyPI simple indexes for scikit-image, matplotlib and kiwisolver had neither `any` nor Emscripten/WASM64 platform tags. The conda-forge `noarch` shard index listed none of these packages or `matplotlib-base`. The 6x `noarch` `matplotlib` package is a wrapper requiring `matplotlib-base`, not a provider for it. The 6x builder channel had the same target artifacts and hashes as the public channel. Swapping unrelated pure packages cannot change the scikit-image edge.

**Upstream handoff:** rebuild the [Emscripten Forge kiwisolver recipe](https://github.com/emscripten-forge/recipes/blob/e12a841b529bb47ae4288997057d5a1da0fafc18/recipes/recipes_emscripten/kiwisolver/recipe.yaml#L26-L38) for `emscripten-wasm64`. The 1.5.1 sdist declares a dynamic version and build requirement `setuptools_scm[toml]>=3.4.3`; the archive's rendered build environment does not list `setuptools_scm`, and its recipe hardcodes `cross-python_emscripten-wasm32`. These are rebuild leads, not proof of the root cause. Test `importlib.metadata.version("kiwisolver")` and the imported extension's version on the target before publishing a new build. Alternatively the scikit-image recipe maintainers could determine whether matplotlib really belongs in `run` and publish a corrected build if not. Neither change is a downstream metadata override.
