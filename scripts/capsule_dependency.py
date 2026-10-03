# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""Resolve DataLab-Web's optional DataLab-Capsule dependency.

DataLab-Capsule is optional: without it, the runtime keeps processing and
reports provenance as unavailable. Release builds only install a published
version; while ``publishedRequirement`` is null, they install nothing.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "datalab-capsule-dependency.json"
DEFAULT_WHEEL_DIR = ROOT / ".wheels"

_MANIFEST_KEYS = {"publishedRequirement", "developmentRef"}
_PUBLISHED_REQUIREMENT_RE = re.compile(r"datalab-capsule==[0-9]+\.[0-9]+\.[0-9]+")
_DEVELOPMENT_REF_RE = re.compile(r"[0-9a-f]{40}")
_ARCHIVE = "https://github.com/DataLab-Platform/DataLab-Capsule/archive/{ref}.zip"


class DependencyConfigError(ValueError):
    """Raised when the DataLab-Capsule dependency manifest is invalid."""


@dataclass(frozen=True)
class CapsuleDependencyConfig:
    """Validated DataLab-Capsule dependency configuration."""

    published_requirement: str | None
    development_ref: str | None

    @property
    def requirement(self) -> str | None:
        """Return the configured requirement (development first), if any."""
        if self.development_ref is not None:
            return f"datalab-capsule @ {_ARCHIVE.format(ref=self.development_ref)}"
        return self.published_requirement


def load_config(manifest: Path = DEFAULT_MANIFEST) -> CapsuleDependencyConfig:
    """Load and validate a DataLab-Capsule dependency manifest."""
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DependencyConfigError(f"Unable to read {manifest}: {exc}") from exc
    if not isinstance(payload, dict) or set(payload) != _MANIFEST_KEYS:
        raise DependencyConfigError(
            f"{manifest} must hold exactly: {', '.join(sorted(_MANIFEST_KEYS))}"
        )
    published = payload["publishedRequirement"]
    if published is not None and (
        not isinstance(published, str)
        or not _PUBLISHED_REQUIREMENT_RE.fullmatch(published)
    ):
        raise DependencyConfigError(
            'publishedRequirement must be null or a pin such as "datalab-capsule==0.1.0"'
        )
    ref = payload["developmentRef"]
    if ref is not None and (
        not isinstance(ref, str) or not _DEVELOPMENT_REF_RE.fullmatch(ref)
    ):
        raise DependencyConfigError(
            "developmentRef must be null or a full lowercase 40-character commit SHA"
        )
    return CapsuleDependencyConfig(published, ref)


def install(config: CapsuleDependencyConfig) -> None:
    """Install the configured requirement into the active interpreter."""
    if config.requirement is None:
        print("No DataLab-Capsule requirement configured; provenance stays off.")
        return
    print(f"Installing DataLab-Capsule dependency: {config.requirement}")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", config.requirement], check=True
    )


def prepare_pyodide(
    config: CapsuleDependencyConfig,
    *,
    wheel_dir: Path = DEFAULT_WHEEL_DIR,
    github_env: Path | None = None,
) -> Path | None:
    """Build the configured wheel and optionally export its Vite install spec."""
    if config.requirement is None:
        print("No DataLab-Capsule requirement configured; nothing to build.")
        return None
    wheel_dir.mkdir(parents=True, exist_ok=True)
    if sorted(wheel_dir.glob("datalab_capsule-*.whl")):
        raise RuntimeError(f"Refusing to reuse DataLab-Capsule wheels in {wheel_dir}")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            "--no-deps",
            "--wheel-dir",
            str(wheel_dir),
            config.requirement,
        ],
        check=True,
    )
    wheels = sorted(wheel_dir.glob("datalab_capsule-*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"Expected one DataLab-Capsule wheel, found {len(wheels)}")
    wheel = wheels[0].resolve()
    if github_env is not None:
        with github_env.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(f"VITE_DATALAB_CAPSULE_INSTALL_SPEC=/@fs/{wheel.as_posix()}\n")
        print(f"Exported VITE_DATALAB_CAPSULE_INSTALL_SPEC to {github_env}")
    return wheel


def create_parser() -> argparse.ArgumentParser:
    """Create the command-line parser."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("install", help="Install the configured requirement")
    prepare_parser = subparsers.add_parser(
        "prepare-pyodide", help="Build and export the configured wheel"
    )
    prepare_parser.add_argument("--wheel-dir", type=Path, default=DEFAULT_WHEEL_DIR)
    prepare_parser.add_argument("--github-env", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    """Run the dependency command."""
    args = create_parser().parse_args(argv)
    config = load_config(args.manifest)
    if args.command == "install":
        install(config)
    else:
        prepare_pyodide(config, wheel_dir=args.wheel_dir, github_env=args.github_env)


if __name__ == "__main__":
    main()
