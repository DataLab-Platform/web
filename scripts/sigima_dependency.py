# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""Resolve DataLab-Web's published or development Sigima dependency."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

if __package__:
    from .build_sigima_wheel import build_wheel
else:
    from build_sigima_wheel import build_wheel

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "sigima-dependency.json"
DEFAULT_REQUIREMENTS = ROOT / "requirements-dev.txt"
DEFAULT_WHEEL_DIR = ROOT / ".wheels"

_MANIFEST_KEYS = {"publishedRequirement", "developmentRef"}
_PUBLISHED_REQUIREMENT_RE = re.compile(r"sigima==[0-9]+\.[0-9]+\.[0-9]+")
_DEVELOPMENT_REF_RE = re.compile(r"[0-9a-f]{40}")
_SIGIMA_ARCHIVE = "https://github.com/DataLab-Platform/Sigima/archive/{ref}.zip"
_WHEEL_BUILD_REQUIREMENTS = ("Babel>=2.17",)

Selection = Literal["configured", "published"]
WheelBuilder = Callable[[str, Path], Path]


class DependencyConfigError(ValueError):
    """Raised when the Sigima dependency manifest is invalid."""


@dataclass(frozen=True)
class SigimaDependencyConfig:
    """Validated Sigima dependency configuration."""

    published_requirement: str
    development_ref: str | None

    @property
    def development_requirement(self) -> str | None:
        """Return the immutable source requirement, if one is configured."""
        if self.development_ref is None:
            return None
        archive = _SIGIMA_ARCHIVE.format(ref=self.development_ref)
        return f"sigima @ {archive}"

    def requirement_for(self, selection: Selection = "configured") -> str:
        """Return the requirement selected for installation."""
        if selection == "published":
            return self.published_requirement
        if selection != "configured":
            raise ValueError(f"Unknown Sigima dependency selection: {selection}")
        return self.development_requirement or self.published_requirement


def load_config(manifest: Path = DEFAULT_MANIFEST) -> SigimaDependencyConfig:
    """Load and validate a Sigima dependency manifest."""
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DependencyConfigError(f"Unable to read {manifest}: {exc}") from exc

    if not isinstance(payload, dict):
        raise DependencyConfigError(f"{manifest} must contain a JSON object")
    keys = set(payload)
    if keys != _MANIFEST_KEYS:
        missing = sorted(_MANIFEST_KEYS - keys)
        unexpected = sorted(keys - _MANIFEST_KEYS)
        details = []
        if missing:
            details.append(f"missing keys: {', '.join(missing)}")
        if unexpected:
            details.append(f"unexpected keys: {', '.join(unexpected)}")
        raise DependencyConfigError(f"Invalid {manifest}: {'; '.join(details)}")

    published = payload["publishedRequirement"]
    if not isinstance(published, str) or not _PUBLISHED_REQUIREMENT_RE.fullmatch(
        published
    ):
        raise DependencyConfigError(
            'publishedRequirement must be an exact stable pin such as "sigima==1.3.0"'
        )

    development_ref = payload["developmentRef"]
    if development_ref is not None and (
        not isinstance(development_ref, str)
        or not _DEVELOPMENT_REF_RE.fullmatch(development_ref)
    ):
        raise DependencyConfigError(
            "developmentRef must be null or a full lowercase 40-character commit SHA"
        )

    return SigimaDependencyConfig(published, development_ref)


def install_python_dependencies(
    config: SigimaDependencyConfig,
    *,
    selection: Selection = "configured",
    requirements: Path = DEFAULT_REQUIREMENTS,
) -> None:
    """Install common test dependencies and the selected Sigima requirement."""
    if not requirements.is_file():
        raise FileNotFoundError(f"Requirements file not found: {requirements}")
    requirement = config.requirement_for(selection)
    print(f"Installing Sigima dependency: {requirement}")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(requirements)],
        check=True,
    )
    subprocess.run(
        [sys.executable, "-m", "pip", "install", requirement],
        check=True,
    )


def install_wheel_build_requirements() -> None:
    """Install the lightweight tools required to build the snapshot wheel."""
    subprocess.run(
        [sys.executable, "-m", "pip", "install", *_WHEEL_BUILD_REQUIREMENTS],
        check=True,
    )


def prepare_pyodide_snapshot(
    config: SigimaDependencyConfig,
    *,
    wheel_dir: Path = DEFAULT_WHEEL_DIR,
    github_env: Path | None = None,
    builder: WheelBuilder = build_wheel,
) -> Path | None:
    """Build and export the configured development wheel for Vite."""
    requirement = config.development_requirement
    if requirement is None:
        print(
            "No Sigima development snapshot is configured; "
            f"Pyodide will install {config.published_requirement}."
        )
        return None

    print(f"Building Sigima development snapshot {config.development_ref}")
    wheel = builder(requirement, wheel_dir).resolve()
    if not wheel.is_file() or not wheel.match("sigima-*.whl"):
        raise RuntimeError(f"Snapshot builder returned an invalid wheel path: {wheel}")
    if github_env is not None:
        install_spec = f"/@fs/{wheel.as_posix()}"
        with github_env.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(f"VITE_SIGIMA_INSTALL_SPEC={install_spec}\n")
        print(f"Exported VITE_SIGIMA_INSTALL_SPEC to {github_env}")
    return wheel


def create_parser() -> argparse.ArgumentParser:
    """Create the command-line parser."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="Path to sigima-dependency.json",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    install_parser = subparsers.add_parser(
        "install", help="Install Python test dependencies"
    )
    install_parser.add_argument(
        "--published",
        action="store_true",
        help="Ignore developmentRef and install the published requirement",
    )
    install_parser.add_argument(
        "--requirements", type=Path, default=DEFAULT_REQUIREMENTS
    )

    prepare_parser = subparsers.add_parser(
        "prepare-pyodide", help="Build and export the configured snapshot wheel"
    )
    prepare_parser.add_argument("--wheel-dir", type=Path, default=DEFAULT_WHEEL_DIR)
    prepare_parser.add_argument(
        "--github-env",
        type=Path,
        help="Append VITE_SIGIMA_INSTALL_SPEC to this GitHub environment file",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    """Run the dependency orchestration command."""
    args = create_parser().parse_args(argv)
    config = load_config(args.manifest)
    if args.command == "install":
        selection: Selection = "published" if args.published else "configured"
        install_python_dependencies(
            config, selection=selection, requirements=args.requirements
        )
    elif args.command == "prepare-pyodide":
        if config.development_ref is not None:
            install_wheel_build_requirements()
        prepare_pyodide_snapshot(
            config, wheel_dir=args.wheel_dir, github_env=args.github_env
        )


if __name__ == "__main__":
    main()
