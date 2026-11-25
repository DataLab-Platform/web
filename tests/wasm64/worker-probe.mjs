// Test-only module worker. No arbitrary Python or file paths are accepted.
const base = new URL("./", self.location.href);
async function json(path) {
  const response = await fetch(new URL(path, base));
  if (!response.ok) throw new Error(`${response.status}: ${path}`);
  return response.json();
}

async function qualify() {
  const memory64 = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1);
  if (!WebAssembly.validate(memory64)) throw new Error("Memory64 unavailable");
  const core = new URL(self.location.href).searchParams.has("core");
  const { urls, archives } = core
    ? { urls: [], archives: [] }
    : await json("environment.json");
  const { initializePyjsRuntime } = await import(
    core ? "./dist/wasm64.js" : "./pyjs/dist/wasm64.js"
  );
  const py = await initializePyjsRuntime({
    assetsUrl: new URL(core ? "assets/" : "pyjs/", base).href,
    urls: urls.map((item) => ({ ...item, url: new URL(item.url, base).href })),
    archives: archives.map((item) => ({
      ...item,
      url: new URL(item.url, base).href,
    })),
    cdnFallback: false,
    verifySha256: true,
    cache: false,
  });
  py.exec(`
import struct, sys, pyjs
assert sys.platform == "emscripten" and struct.calcsize("P") == 8
def add(*, a, b):
    return a+b
`);
  const add = py.eval("add");
  try {
    if (add.py_apply([], { a: 3, b: 4 }) !== 7)
      throw new Error("kwargs failed");
  } finally {
    add.delete();
  }
  const bytes = py.eval(
    "pyjs.buffer_to_js_typed_array(memoryview(b'\\x03\\xfe'), view=False)",
  );
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== 2 ||
    bytes.buffer.byteLength !== 2
  )
    throw new Error("Expected two owned bytes");
  const report = {
    kind: "done",
    arch: py.pyjsArch,
    pointerBytes: py.eval('struct.calcsize("P")'),
    python: py.pythonVersion,
    bytes,
  };
  self.requestEdit = (schema) =>
    new Promise((resolve) => {
      self.addEventListener("message", (event) => resolve(event.data), {
        once: true,
      });
      self.postMessage({ kind: "edit", schema });
    });
  if (core) {
    await py.async_exec_eval(`
reply = await pyjs.js.requestEdit(pyjs.to_js({"probe": True}, dict_converter=pyjs.js.Object.fromEntries))
assert pyjs.to_py(reply) == {"sigma": 1.25}
`);
    self.postMessage({ ...report, tier: "core-only" }, [bytes.buffer]);
    return;
  }
  py.exec(`
import numpy as np, h5py, pandas, pywt, skimage, scipy, PIL, sigima, pyjs
from importlib.metadata import version
import kiwisolver as kiwi
from packaging.version import Version
assert Version(kiwi.__version__) >= Version("1.3.1")
x, y, solver = kiwi.Variable("x"), kiwi.Variable("y"), kiwi.Solver()
solver.addConstraint(x + y == 12)
solver.addConstraint(x - y == 2)
solver.updateVariables()
assert (x.value(), y.value()) == (7, 5)
import matplotlib
from sigima import create_image
from sigima.params import GaussianParam
from sigima.proc.image import gaussian_filter
from guidata.dataset import backends, dataset_to_schema_with_values, update_dataset

async def edit(dataset, **_kwargs):
    payload = pyjs.to_js(dataset_to_schema_with_values(dataset),
                         dict_converter=pyjs.js.Object.fromEntries)
    answer = await pyjs.js.requestEdit(payload)
    update_dataset(dataset, pyjs.to_py(answer))
    return True

backends.set_handler("edit_dataset_async", edit)
source = create_image("probe", np.arange(63, dtype=np.float32).reshape(7,9))
param = GaussianParam.create(sigma=1.0)
`);
  await py.async_exec_eval(`
assert await param.edit_async()
assert param.sigma == 1.25
out = gaussian_filter(source, param)
assert out.data.shape == (7,9)
with h5py.File("/probe.h5", "w") as f:
    f.create_dataset("result", data=out.data)
with h5py.File("/probe.h5") as f:
    np.testing.assert_array_equal(f["result"][:], out.data)
`);
  const versions = py.eval(
    `pyjs.to_js({p:version(p) for p in ["sigima","guidata","numpy","scipy","scikit-image","pandas","PyWavelets","Pillow","h5py","datalab-capsule"]}, dict_converter=pyjs.js.Object.fromEntries)`,
  );
  const kiwi = {
    extension: py.eval("kiwi.__version__"),
    distribution: py.eval('version("kiwisolver")'),
    matplotlib: py.eval("matplotlib.__version__"),
  };
  self.postMessage({ ...report, tier: "science", versions, kiwi }, [
    bytes.buffer,
  ]);
}

qualify().catch((error) =>
  self.postMessage({ kind: "error", detail: String(error) }),
);
