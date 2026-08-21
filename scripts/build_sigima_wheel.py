# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""Build a Sigima source requirement with compiled gettext catalogs."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def run(*args: str) -> None:
    """Run a Python module command with the active interpreter."""
    subprocess.run([sys.executable, *args], check=True)


def build_wheel(requirement: str, wheel_dir: Path) -> Path:
    """Build *requirement* into *wheel_dir* after compiling translations."""
    wheel_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="sigima-wheel-") as tmp:
        workspace = Path(tmp)
        downloads = workspace / "downloads"
        downloads.mkdir()
        run(
            "-m",
            "pip",
            "download",
            "--no-deps",
            "--no-binary=:all:",
            "--dest",
            str(downloads),
            requirement,
        )

        archives = list(downloads.iterdir())
        if len(archives) != 1:
            raise RuntimeError(f"Expected one Sigima archive, found {len(archives)}")
        source_tree = workspace / "source"
        shutil.unpack_archive(archives[0], source_tree)

        projects = list(source_tree.glob("*/pyproject.toml"))
        if len(projects) != 1:
            raise RuntimeError(f"Expected one Sigima project, found {len(projects)}")
        project = projects[0].parent
        locale_dir = project / "sigima" / "locale"
        run(
            "-m",
            "babel.messages.frontend",
            "compile",
            "--directory",
            str(locale_dir),
            "--domain",
            "sigima",
        )
        run(
            "-m",
            "pip",
            "wheel",
            "--no-deps",
            "--wheel-dir",
            str(wheel_dir),
            str(project),
        )

    wheels = list(wheel_dir.glob("sigima-*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"Expected one Sigima wheel, found {len(wheels)}")
    return wheels[0]


def main() -> None:
    """Build a wheel from the requested Sigima source revision."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("requirement", help="PEP 508 Sigima source requirement")
    parser.add_argument("wheel_dir", type=Path, help="Output wheel directory")
    args = parser.parse_args()
    print(build_wheel(args.requirement, args.wheel_dir))


if __name__ == "__main__":
    main()
