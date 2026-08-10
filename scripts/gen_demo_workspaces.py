"""Generate the demo HDF5 workspaces served under ``public/demos/``.

These workspaces back the ``?preload=`` deep links used by the documentation
"use case" pages (spectroscopy, photonics, NDT). The on-disk layout mirrors
``src/runtime/bootstrap.py::save_workspace_to_bytes`` (itself bit-compatible
with Qt DataLab's "Save HDF5 workspace"), so the files open in both editions.

Run with an environment providing ``sigima`` and ``guidata`` (e.g. the
DataLab desktop venv)::

    python scripts/gen_demo_workspaces.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import sigima
from guidata.io import HDF5Writer
from ndt_synthetic import generate_synthetic_radiograph
from sigima.objects import create_image

HERE = Path(__file__).resolve().parent
OUTDIR = HERE.parent / "public" / "demos"
SIGIMA_TESTS = Path(sigima.__file__).resolve().parent / "data" / "tests"

_H5_DATALAB_VERSION_KEY = "DataLab_Version"
_H5_PANEL_PREFIXES = {"signal": "DataLab_Sig", "image": "DataLab_Ima"}


def _sanitize(short_id: str, title: str) -> str:
    """Sanitize a title for use as an HDF5 group name."""
    safe = re.sub("[^-a-zA-Z0-9_.() ]+", "", (title or "").replace("/", "_"))
    return f"{short_id}: {safe}".rstrip(": ").rstrip()


def write_workspace(path: Path, panels: dict[str, dict[str, list]]) -> None:
    """Write *panels* ({kind: {group_name: [objects]}}) as a DataLab workspace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    writer = HDF5Writer(str(path))
    try:
        writer.h5[_H5_DATALAB_VERSION_KEY] = sigima.__version__
        for kind, groups in panels.items():
            prefix = _H5_PANEL_PREFIXES[kind]
            sid = "s" if kind == "signal" else "i"
            with writer.group(prefix):
                for gidx, (group_name, objs) in enumerate(groups.items(), start=1):
                    gname = _sanitize(f"g{gidx:03d}", group_name)
                    with writer.group(gname):
                        with writer.group("title"):
                            writer.write_str(group_name)
                        for oidx, obj in enumerate(objs, start=1):
                            oname = _sanitize(f"{sid}{oidx:03d}", obj.title or "")
                            with writer.group(oname):
                                obj.serialize(writer)
    finally:
        writer.close()
    print(f"{path.relative_to(HERE.parent)}: {path.stat().st_size / 1024:.0f} KB")


def load_image(path: Path) -> np.ndarray:
    """Load an image from disk and return a 2D array (grayscale)."""
    import PIL.Image

    with PIL.Image.open(path) as img:
        # 2x2 decimation keeps the demo payload small (page-load budget).
        return np.asarray(img.convert("L"))[::2, ::2]


def make_spectroscopy() -> None:
    """Load a demo spectroscopy signal and write it to a workspace."""
    from sigima.io import read_signals

    obj = read_signals(str(SIGIMA_TESTS / "curve_formats" / "paracetamol.txt"))[0]
    obj.title = "Spectrum (paracetamol)"
    write_workspace(
        OUTDIR / "spectroscopy.h5",
        {"signal": {"Spectroscopy demo": [obj]}},
    )


def make_photonics() -> None:
    """Load a few demo photonics images and write them to a workspace."""
    objs = []
    for z in (13, 45, 80):
        arr = load_image(SIGIMA_TESTS / "laser_beam" / f"TEM00_z_{z}.jpg")
        objs.append(create_image(f"TEM00 beam (z={z})", arr))
    fp = load_image(SIGIMA_TESTS / "fabry-perot1.jpg")
    objs.append(create_image("Fabry-Perot interferogram", fp))
    write_workspace(
        OUTDIR / "photonics.h5",
        {"image": {"Photonics demo": objs}},
    )


def make_ndt() -> None:
    """Generate a synthetic inspection image and write it to a workspace."""
    data, truth = generate_synthetic_radiograph()
    obj = create_image(
        "Synthetic radiograph (NDT spike)",
        data,
    )
    obj.metadata["spike.ndt.synthetic_truth"] = json.dumps(
        truth, sort_keys=True, separators=(",", ":")
    )
    obj.metadata["spike.ndt.disclaimer"] = (
        "Synthetic algorithm-development data; not a qualified radiograph"
    )
    write_workspace(
        OUTDIR / "ndt.h5",
        {"image": {"Synthetic NDT spike": [obj]}},
    )


if __name__ == "__main__":
    make_spectroscopy()
    make_photonics()
    make_ndt()
