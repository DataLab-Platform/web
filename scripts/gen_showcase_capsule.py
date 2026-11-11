"""Generate the showcase capsule served under ``public/demos/``.

The showcase of DataLab Web (scenario W3, capsule and provenance) opens
``public/demos/showcase-capsule.dlcapsule``: a genuine capsule of DataLab
desktop, exported by DataLab desktop itself with the image chain of its own
showcase scenario D2 (``datalab.gui.showcase.scenarios.d2_capsule``)::

    Cells (raw 256x256 8-bit image of 14 noisy cells)
      -> Total variation denoising (weight 0.1)  -> Sobel filter (edges)
      -> Blob detection (LoG) on the denoised image: 14 blobs

The History of the chain is recorded in the capsule. Each operation is
qualified for an exact replay, deterministic and available in Pyodide (no
OpenCV): DataLab Web replays each of them with the verdict "Exact". Before
writing the capsule, the script opens it again in DataLab desktop and replays
each activity (verdicts printed).

DataLab desktop is required (with PlotPy, Sigima and DataLab-Capsule): the
environment of DataLab-Web has neither Qt nor DataLab, so the script runs
itself again with the environment of DataLab (``scripts/run_with_env.py`` of
the sibling ``../DataLab`` folder, or of the ``DATALAB_DIR`` folder). From the
DataLab-Web folder::

    python scripts/run_with_env.py python scripts/gen_showcase_capsule.py

which is the same as, from the DataLab folder::

    python scripts/run_with_env.py python ../DataLab-Web/scripts/gen_showcase_capsule.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / "public" / "demos" / "showcase-capsule.dlcapsule"
DESCRIPTION = (
    "DataLab desktop showcase: raw image of cells, total variation denoising, "
    "Sobel edges and blob detection (LoG)"
)
#: Set when the script runs again in the environment of DataLab
RERUN_FLAG = "DLW_SHOWCASE_CAPSULE_RERUN"


def datalab_available() -> bool:
    """Return True if DataLab desktop and Qt can be imported"""
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    try:
        # pylint: disable=import-outside-toplevel,unused-import
        import qtpy.QtCore  # noqa: F401

        import datalab.gui.showcase.scenarios.d2_capsule  # noqa: F401
    except Exception:  # pylint: disable=broad-exception-caught
        # No Qt bindings (qtpy raises its own errors) or no DataLab
        return False
    return True


def rerun_with_datalab() -> int:
    """Run this script again in the environment of DataLab

    Returns:
        Exit code
    """
    folder = Path(os.environ.get("DATALAB_DIR", HERE.parent.parent / "DataLab"))
    launcher = folder / "scripts" / "run_with_env.py"
    if os.environ.get(RERUN_FLAG) or not launcher.is_file():
        print(
            "DataLab desktop is required: run this script with the environment "
            "of DataLab (see the header of this script), or set DATALAB_DIR.",
            file=sys.stderr,
        )
        return 1
    print(f"Running again with the environment of DataLab ({folder.resolve()})")
    env = dict(os.environ, **{RERUN_FLAG: "1"})
    command = [sys.executable, str(launcher), "python", str(Path(__file__).resolve())]
    return subprocess.call(command, cwd=folder, env=env)


def generate(output: Path) -> None:
    """Build the image chain in DataLab desktop and export it as a capsule

    Args:
        output: Capsule file name

    Raises:
        AssertionError: If the capsule does not replay exactly in DataLab desktop
    """
    # pylint: disable=import-outside-toplevel
    from datalab.config import Conf, ensure_initialized
    from datalab.env import execenv
    from datalab.gui.main import DLMainWindow
    from datalab.gui.showcase.engine import ShowcaseContext
    from datalab.gui.showcase.scenarios import d2_capsule
    from datalab.utils.qthelpers import datalab_app_context

    ensure_initialized(load_user_config=False)
    execenv.unattended = True
    output.parent.mkdir(parents=True, exist_ok=True)
    with (
        tempfile.TemporaryDirectory(prefix="dlw-showcase-capsule-") as folder,
        Conf.process_isolation_enabled.context(False),
        datalab_app_context(exec_loop=False, enable_logs=False),
    ):
        win = DLMainWindow(console=False)
        # Actions are enabled from the selection of a shown window (offscreen)
        win.show()
        try:
            ctx = ShowcaseContext(win, speed=0.0)
            with (
                d2_capsule.recording_history(win),
                d2_capsule.temporary_revisions(win, folder),
            ):
                d2_capsule.build_chain(ctx)
                capsule = os.path.join(folder, output.name)
                fingerprint = d2_capsule.export_capsule(
                    win, capsule, description=DESCRIPTION
                )
                history = len(win.historypanel)
                win.reset_all()
                win.open_capsule(capsule)
                verdicts = {}
                for activity in win.provenance.ledger.activities:
                    operation = activity["call"]["operation"]["id"]
                    report = win.verify_provenance_activity(activity["activity_id"])
                    verdicts[operation] = report["verdict"]
            if set(verdicts.values()) != {"exact"}:
                raise AssertionError(f"Capsule not replayed exactly: {verdicts}")
            shutil.move(capsule, output)
        finally:
            win.set_modified(False)
            win.close()
    size = output.stat().st_size
    print(f"Capsule: {output} ({size / 1024:.0f} KiB)")
    print(f"Fingerprint: {fingerprint}")
    print(f"History actions: {history}")
    for operation, verdict in verdicts.items():
        print(f"  {operation}: {verdict}")


def main() -> int:
    """Generate the showcase capsule

    Returns:
        Exit code
    """
    if not datalab_available():
        return rerun_with_datalab()
    generate(OUTPUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
