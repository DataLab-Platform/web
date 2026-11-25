"""Generate the small HDF5 reference and independently check a browser export."""

from __future__ import annotations

import argparse
import hashlib
import json
from importlib.metadata import version
from pathlib import Path

import numpy as np
from datalab_capsule.hdf5 import read_block
from guidata.io import HDF5Reader, HDF5Writer
from sigima import create_image, create_signal
from sigima.objects import ImageObj, SignalObj
from sigima.params import GaussianParam
from sigima.proc.image import gaussian_filter

SIGMA = 1.25
ROOT = Path(__file__).resolve().parents[2]


def sources() -> tuple[ImageObj, SignalObj]:
    rows, cols = np.ogrid[:193, :257]
    data = ((11 * rows + 7 * cols) % 251).astype(np.float32) / np.float32(250)
    data[0, -2], data[-3, 1] = 1.0, 0.0
    im = create_image("Reference image", data, units=("mm", "mm", "V"))
    im.x0, im.y0, im.dx, im.dy = -3.0, 7.5, 0.125, 0.25
    x = np.arange(17, dtype=np.float64)
    sig = create_signal("Reference signal", x, 3 * x - 1, units=("s", "A"))
    for obj in [im, sig]:
        obj.metadata["reference_case"] = "wasm64-A"
    return im, sig


def write_reference(path: Path) -> None:
    im, sig = sources()
    writer = HDF5Writer(str(path))
    try:
        writer.h5["DataLab_Version"] = version("sigima")
        for panel, obj in [("DataLab_Ima", im), ("DataLab_Sig", sig)]:
            with writer.group(panel), writer.group("g001: Reference"):
                with writer.group("title"):
                    writer.write_str("Reference")
                with writer.group(f"001: {obj.title}"):
                    obj.serialize(writer)
    finally:
        writer.close()


def read_panel(reader: HDF5Reader, panel: str, cls: type) -> list:
    loaded = []
    for group in reader.h5[panel]:
        with reader.group(panel), reader.group(group):
            items = [key for key in reader.h5[panel][group] if key != "title"]
            if not items:
                continue
            with reader.group("title"):
                np.testing.assert_equal(reader.read_str(), "Reference")
            for key in items:
                obj = cls()
                with reader.group(key):
                    obj.deserialize(reader)
                loaded.append(obj)
    return loaded


def verify(path: Path, filtered: bool) -> dict:
    im, sig = sources()
    reader = HDF5Reader(str(path))
    try:
        images = read_panel(reader, "DataLab_Ima", ImageObj)
        signals = read_panel(reader, "DataLab_Sig", SignalObj)
        if filtered:
            block = read_block(reader.h5)
            if block is None:
                raise ValueError("Browser export has no provenance block")
            ledger, locators = block
            (activity,) = ledger.to_dict()["activities"]
            call = activity["call"]
            np.testing.assert_equal(
                call["operation"]["id"], "sigima.image.gaussian_filter"
            )
            np.testing.assert_equal(call["parameters"]["sigma"], SIGMA)
            source_id = call["inputs"][0]["binding"]["state_id"]
            result_id = activity["outputs"][0]["state_id"]
            np.testing.assert_equal(locators[source_id]["kind"], "image")
            np.testing.assert_equal(locators[result_id]["kind"], "image")
    finally:
        reader.close()
    np.testing.assert_equal((len(images), len(signals)), (1 + int(filtered), 1))
    (source,) = [obj for obj in images if obj.title == im.title]
    for actual, expected in [(source, im), (signals[0], sig)]:
        np.testing.assert_equal(actual.metadata["reference_case"], "wasm64-A")
        np.testing.assert_equal(
            (actual.title, actual.xunit, actual.yunit),
            (expected.title, expected.xunit, expected.yunit),
        )
    np.testing.assert_array_equal(source.data, im.data, strict=True)
    np.testing.assert_array_equal(signals[0].x, sig.x, strict=True)
    np.testing.assert_array_equal(signals[0].y, sig.y, strict=True)
    for obj in images:
        np.testing.assert_equal(
            (obj.x0, obj.y0, obj.dx, obj.dy, obj.xunit, obj.yunit, obj.zunit),
            (im.x0, im.y0, im.dx, im.dy, im.xunit, im.yunit, im.zunit),
        )
    report = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    if filtered:
        (result,) = [obj for obj in images if obj is not source]
        expected = gaussian_filter(im, GaussianParam.create(sigma=SIGMA)).data
        np.testing.assert_equal(result.data.shape, expected.shape)
        np.testing.assert_equal(result.data.dtype, expected.dtype)
        np.testing.assert_allclose(result.data, expected, rtol=1e-5, atol=1e-6)
        report["max_absolute_error"] = float(np.max(np.abs(result.data - expected)))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["generate", "verify"])
    parser.add_argument("file", type=Path)
    args = parser.parse_args()
    requirement = json.loads((ROOT / "sigima-dependency.json").read_text())[
        "publishedRequirement"
    ]
    if f"sigima=={version('sigima')}" != requirement:
        parser.error(f"Native qualification requires {requirement}")
    if args.action == "generate":
        args.file.parent.mkdir(parents=True, exist_ok=True)
        write_reference(args.file)
    print(
        json.dumps(
            {
                "versions": {
                    p: version(p)
                    for p in ("sigima", "guidata", "numpy", "scipy", "h5py")
                },
                "sigma": SIGMA,
                **verify(args.file, args.action == "verify"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
