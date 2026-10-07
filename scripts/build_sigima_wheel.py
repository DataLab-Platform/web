# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""Build a Sigima or guidata source requirement with compiled gettext catalogs."""

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


def build_wheel(requirement: str, wheel_dir: Path, package: str = "sigima") -> Path:
    """Build *requirement* into *wheel_dir* after compiling translations."""
    wheel_dir.mkdir(parents=True, exist_ok=True)
    existing_wheels = sorted(wheel_dir.glob(f"{package}-*.whl"))
    if existing_wheels:
        names = ", ".join(wheel.name for wheel in existing_wheels)
        raise RuntimeError(
            f"Refusing to reuse {package} wheels already present in {wheel_dir}: "
            f"{names}"
        )
    with tempfile.TemporaryDirectory(prefix=f"{package}-wheel-") as tmp:
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
            raise RuntimeError(f"Expected one {package} archive, found {len(archives)}")
        source_tree = workspace / "source"
        shutil.unpack_archive(archives[0], source_tree)

        projects = list(source_tree.glob("*/pyproject.toml"))
        if len(projects) != 1:
            raise RuntimeError(f"Expected one {package} project, found {len(projects)}")
        project = projects[0].parent
        locale_dir = project / package / "locale"
        run(
            "-m",
            "babel.messages.frontend",
            "compile",
            "--directory",
            str(locale_dir),
            "--domain",
            package,
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

    wheels = sorted(wheel_dir.glob(f"{package}-*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"Expected one {package} wheel, found {len(wheels)}")
    return wheels[0]


def main() -> None:
    """Build a wheel from the requested Sigima or guidata source revision."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("requirement", help="PEP 508 source requirement")
    parser.add_argument("wheel_dir", type=Path, help="Output wheel directory")
    parser.add_argument("--package", choices=("sigima", "guidata"), default="sigima")
    args = parser.parse_args()
    print(build_wheel(args.requirement, args.wheel_dir, args.package))


if __name__ == "__main__":
    main()
