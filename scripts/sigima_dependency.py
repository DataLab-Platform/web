# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""Resolve DataLab-Web's published or development Sigima and guidata dependencies."""

from __future__ import annotations

import argparse
import functools
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
DEFAULT_GUIDATA_MANIFEST = ROOT / "guidata-dependency.json"
DEFAULT_REQUIREMENTS = ROOT / "requirements-dev.txt"
DEFAULT_WHEEL_DIR = ROOT / ".wheels"

_MANIFEST_KEYS = {"publishedRequirement", "developmentRef"}
_DEVELOPMENT_REF_RE = re.compile(r"[0-9a-f]{40}")
_WHEEL_BUILD_REQUIREMENTS = ("Babel>=2.17",)

Package = Literal["sigima", "guidata"]
Selection = Literal["configured", "published"]
WheelBuilder = Callable[[str, Path], Path]


@dataclass(frozen=True)
class _PackageRules:
    published_re: re.Pattern[str]
    published_error: str
    archive: str
    env_var: str


_PACKAGE_RULES: dict[str, _PackageRules] = {
    "sigima": _PackageRules(
        re.compile(r"sigima==[0-9]+\.[0-9]+\.[0-9]+"),
        'an exact stable pin such as "sigima==1.3.0"',
        "https://github.com/DataLab-Platform/Sigima/archive/{ref}.zip",
        "VITE_SIGIMA_INSTALL_SPEC",
    ),
    "guidata": _PackageRules(
        re.compile(r"guidata(==|>=)[0-9]+\.[0-9]+\.[0-9]+"),
        'an exact pin or a lower bound such as "guidata>=3.15.0"',
        "https://github.com/PlotPyStack/guidata/archive/{ref}.zip",
        "VITE_GUIDATA_INSTALL_SPEC",
    ),
}


class DependencyConfigError(ValueError):
    """Raised when a dependency manifest is invalid."""


@dataclass(frozen=True)
class DependencyConfig:
    """Validated Sigima or guidata dependency configuration."""

    published_requirement: str
    development_ref: str | None
    package: Package = "sigima"

    @property
    def development_requirement(self) -> str | None:
        """Return the immutable source requirement, if one is configured."""
        if self.development_ref is None:
            return None
        archive = _PACKAGE_RULES[self.package].archive.format(ref=self.development_ref)
        return f"{self.package} @ {archive}"

    def requirement_for(self, selection: Selection = "configured") -> str:
        """Return the requirement selected for installation."""
        if selection == "published":
            return self.published_requirement
        if selection != "configured":
            raise ValueError(f"Unknown dependency selection: {selection}")
        return self.development_requirement or self.published_requirement


def load_config(
    manifest: Path = DEFAULT_MANIFEST, package: Package = "sigima"
) -> DependencyConfig:
    """Load and validate a Sigima or guidata dependency manifest."""
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

    rules = _PACKAGE_RULES[package]
    published = payload["publishedRequirement"]
    if not isinstance(published, str) or not rules.published_re.fullmatch(published):
        raise DependencyConfigError(
            f"publishedRequirement must be {rules.published_error}"
        )

    development_ref = payload["developmentRef"]
    if development_ref is not None and (
        not isinstance(development_ref, str)
        or not _DEVELOPMENT_REF_RE.fullmatch(development_ref)
    ):
        raise DependencyConfigError(
            "developmentRef must be null or a full lowercase 40-character commit SHA"
        )

    return DependencyConfig(published, development_ref, package)


def install_python_dependencies(
    configs: Sequence[DependencyConfig],
    *,
    selection: Selection = "configured",
    requirements: Path = DEFAULT_REQUIREMENTS,
) -> None:
    """Install common test dependencies and the selected package requirements."""
    if not requirements.is_file():
        raise FileNotFoundError(f"Requirements file not found: {requirements}")
    selected = [config.requirement_for(selection) for config in configs]
    snapshots = [
        config.development_requirement
        for config in configs
        if selection == "configured" and config.development_requirement
    ]
    for requirement in selected:
        print(f"Installing dependency: {requirement}")
    pip_install = [sys.executable, "-m", "pip", "install"]
    subprocess.run([*pip_install, "-r", str(requirements)], check=True)
    if snapshots:
        # A snapshot may share its version with the installed release, which
        # pip would keep: replace it first, then resolve its dependencies.
        subprocess.run(
            [*pip_install, "--force-reinstall", "--no-deps", *snapshots], check=True
        )
    subprocess.run([*pip_install, *selected], check=True)


def install_wheel_build_requirements() -> None:
    """Install the lightweight tools required to build the snapshot wheel."""
    subprocess.run(
        [sys.executable, "-m", "pip", "install", *_WHEEL_BUILD_REQUIREMENTS],
        check=True,
    )


def prepare_pyodide_snapshot(
    config: DependencyConfig,
    *,
    wheel_dir: Path = DEFAULT_WHEEL_DIR,
    github_env: Path | None = None,
    builder: WheelBuilder | None = None,
) -> Path | None:
    """Build and export the configured development wheel for Vite."""
    requirement = config.development_requirement
    if requirement is None:
        print(
            f"No {config.package} development snapshot is configured; "
            f"Pyodide will install {config.published_requirement}."
        )
        return None

    if builder is None:
        builder = functools.partial(build_wheel, package=config.package)
    print(f"Building {config.package} development snapshot {config.development_ref}")
    wheel = builder(requirement, wheel_dir).resolve()
    if not wheel.is_file() or not wheel.match(f"{config.package}-*.whl"):
        raise RuntimeError(f"Snapshot builder returned an invalid wheel path: {wheel}")
    if github_env is not None:
        env_var = _PACKAGE_RULES[config.package].env_var
        install_spec = f"/@fs/{wheel.as_posix()}"
        with github_env.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(f"{env_var}={install_spec}\n")
        print(f"Exported {env_var} to {github_env}")
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
    parser.add_argument(
        "--guidata-manifest",
        type=Path,
        default=DEFAULT_GUIDATA_MANIFEST,
        help="Path to guidata-dependency.json",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    install_parser = subparsers.add_parser(
        "install", help="Install Python test dependencies"
    )
    install_parser.add_argument(
        "--published",
        action="store_true",
        help="Ignore developmentRef and install the published requirements",
    )
    install_parser.add_argument(
        "--requirements", type=Path, default=DEFAULT_REQUIREMENTS
    )

    prepare_parser = subparsers.add_parser(
        "prepare-pyodide", help="Build and export the configured snapshot wheels"
    )
    prepare_parser.add_argument("--wheel-dir", type=Path, default=DEFAULT_WHEEL_DIR)
    prepare_parser.add_argument(
        "--github-env",
        type=Path,
        help="Append VITE_*_INSTALL_SPEC overrides to this GitHub env file",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    """Run the dependency orchestration command."""
    args = create_parser().parse_args(argv)
    configs = (
        load_config(args.guidata_manifest, "guidata"),
        load_config(args.manifest, "sigima"),
    )
    if args.command == "install":
        selection: Selection = "published" if args.published else "configured"
        install_python_dependencies(
            configs, selection=selection, requirements=args.requirements
        )
    elif args.command == "prepare-pyodide":
        if any(config.development_ref is not None for config in configs):
            install_wheel_build_requirements()
        for config in configs:
            prepare_pyodide_snapshot(
                config, wheel_dir=args.wheel_dir, github_env=args.github_env
            )


if __name__ == "__main__":
    main()
