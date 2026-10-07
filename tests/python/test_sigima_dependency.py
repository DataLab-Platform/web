# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import build_sigima_wheel
from scripts import sigima_dependency as dependency

PUBLISHED_REQUIREMENT = "sigima==1.3.0"
DEVELOPMENT_REF = "4442ada873655f63fabd14369fd11170f75a28b4"
GUIDATA_REQUIREMENT = "guidata>=3.15.0"
GUIDATA_REF = "7203944df510bac341df643a97ff17850ff3fe92"


def write_manifest(
    path: Path,
    *,
    published: object = PUBLISHED_REQUIREMENT,
    development_ref: object = DEVELOPMENT_REF,
) -> Path:
    """Write a dependency manifest for one test."""
    path.write_text(
        json.dumps(
            {
                "publishedRequirement": published,
                "developmentRef": development_ref,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_load_config_resolves_immutable_development_requirement(tmp_path: Path):
    config = dependency.load_config(write_manifest(tmp_path / "dependency.json"))

    assert config.published_requirement == PUBLISHED_REQUIREMENT
    assert config.requirement_for("published") == PUBLISHED_REQUIREMENT
    assert config.requirement_for() == (
        "sigima @ https://github.com/DataLab-Platform/Sigima/archive/"
        f"{DEVELOPMENT_REF}.zip"
    )


def test_null_development_ref_selects_published_requirement(tmp_path: Path):
    config = dependency.load_config(
        write_manifest(tmp_path / "dependency.json", development_ref=None)
    )

    assert config.development_requirement is None
    assert config.requirement_for() == PUBLISHED_REQUIREMENT


def test_repository_manifests_are_valid():
    sigima = dependency.load_config(dependency.DEFAULT_MANIFEST, "sigima")
    guidata = dependency.load_config(dependency.DEFAULT_GUIDATA_MANIFEST, "guidata")

    assert sigima.requirement_for("published").startswith("sigima==")
    assert guidata.requirement_for("published").startswith("guidata")


def test_guidata_manifest_resolves_its_own_archive(tmp_path: Path):
    config = dependency.load_config(
        write_manifest(
            tmp_path / "guidata.json",
            published=GUIDATA_REQUIREMENT,
            development_ref=GUIDATA_REF,
        ),
        "guidata",
    )

    assert config.requirement_for("published") == GUIDATA_REQUIREMENT
    assert config.requirement_for() == (
        f"guidata @ https://github.com/PlotPyStack/guidata/archive/{GUIDATA_REF}.zip"
    )


@pytest.mark.parametrize(
    "published", ["guidata~=3.15.0", "guidata>=3.15", "sigima==1.3.0"]
)
def test_guidata_manifest_rejects_other_requirements(tmp_path: Path, published: str):
    manifest = write_manifest(
        tmp_path / "guidata.json", published=published, development_ref=None
    )

    with pytest.raises(dependency.DependencyConfigError, match="lower bound"):
        dependency.load_config(manifest, "guidata")


@pytest.mark.parametrize(
    ("published", "development_ref", "message"),
    [
        ("sigima>=1.3.0", DEVELOPMENT_REF, "exact stable pin"),
        ("sigima==1.3", DEVELOPMENT_REF, "exact stable pin"),
        (PUBLISHED_REQUIREMENT, "develop", "full lowercase"),
        (PUBLISHED_REQUIREMENT, DEVELOPMENT_REF[:12], "full lowercase"),
        (PUBLISHED_REQUIREMENT, DEVELOPMENT_REF.upper(), "full lowercase"),
    ],
)
def test_load_config_rejects_mutable_or_inexact_values(
    tmp_path: Path, published: object, development_ref: object, message: str
):
    manifest = write_manifest(
        tmp_path / "dependency.json",
        published=published,
        development_ref=development_ref,
    )

    with pytest.raises(dependency.DependencyConfigError, match=message):
        dependency.load_config(manifest)


def test_load_config_rejects_schema_drift(tmp_path: Path):
    manifest = tmp_path / "dependency.json"
    manifest.write_text(
        json.dumps(
            {
                "publishedRequirement": PUBLISHED_REQUIREMENT,
                "developmentRef": DEVELOPMENT_REF,
                "branch": "develop",
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(dependency.DependencyConfigError, match="unexpected keys"):
        dependency.load_config(manifest)


def test_install_python_dependencies_uses_selected_requirements(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    configs = (
        dependency.DependencyConfig(GUIDATA_REQUIREMENT, GUIDATA_REF, "guidata"),
        dependency.DependencyConfig(PUBLISHED_REQUIREMENT, DEVELOPMENT_REF),
    )
    requirements = tmp_path / "requirements-dev.txt"
    requirements.write_text("pytest>=7.4\n", encoding="utf-8")
    commands: list[list[str]] = []

    def record(command: list[str], *, check: bool) -> None:
        assert check is True
        commands.append(command)

    monkeypatch.setattr(dependency.subprocess, "run", record)

    dependency.install_python_dependencies(
        configs, selection="published", requirements=requirements
    )
    dependency.install_python_dependencies(configs, requirements=requirements)

    pip = [dependency.sys.executable, "-m", "pip", "install"]
    snapshots = [config.development_requirement for config in configs]
    assert commands == [
        [*pip, "-r", str(requirements)],
        [*pip, GUIDATA_REQUIREMENT, PUBLISHED_REQUIREMENT],
        [*pip, "-r", str(requirements)],
        [*pip, "--force-reinstall", "--no-deps", *snapshots],
        [*pip, *snapshots],
    ]


def test_prepare_pyodide_snapshot_exports_built_wheel(tmp_path: Path):
    config = dependency.DependencyConfig(PUBLISHED_REQUIREMENT, DEVELOPMENT_REF)
    wheel_dir = tmp_path / "wheels"
    wheel = wheel_dir / "sigima-1.3.0-py3-none-any.whl"
    github_env = tmp_path / "github.env"
    requirements: list[str] = []

    def build(requirement: str, output: Path) -> Path:
        requirements.append(requirement)
        assert output == wheel_dir
        output.mkdir()
        wheel.touch()
        return wheel

    result = dependency.prepare_pyodide_snapshot(
        config, wheel_dir=wheel_dir, github_env=github_env, builder=build
    )

    assert result == wheel.resolve()
    assert requirements == [config.development_requirement]
    assert github_env.read_text(encoding="utf-8") == (
        f"VITE_SIGIMA_INSTALL_SPEC=/@fs/{wheel.resolve().as_posix()}\n"
    )


def test_prepare_pyodide_snapshot_exports_guidata_wheel(tmp_path: Path):
    config = dependency.DependencyConfig(GUIDATA_REQUIREMENT, GUIDATA_REF, "guidata")
    wheel = tmp_path / "guidata-3.16.0-py3-none-any.whl"
    wheel.touch()
    github_env = tmp_path / "github.env"

    result = dependency.prepare_pyodide_snapshot(
        config,
        wheel_dir=tmp_path,
        github_env=github_env,
        builder=lambda _requirement, _output: wheel,
    )

    assert result == wheel.resolve()
    assert github_env.read_text(encoding="utf-8") == (
        f"VITE_GUIDATA_INSTALL_SPEC=/@fs/{wheel.resolve().as_posix()}\n"
    )


def test_prepare_pyodide_without_snapshot_does_not_build_or_export(tmp_path: Path):
    config = dependency.DependencyConfig(PUBLISHED_REQUIREMENT, None)
    github_env = tmp_path / "github.env"

    def unexpected_build(_requirement: str, _output: Path) -> Path:
        raise AssertionError("builder must not be called in published mode")

    result = dependency.prepare_pyodide_snapshot(
        config, github_env=github_env, builder=unexpected_build
    )

    assert result is None
    assert not github_env.exists()


def test_prepare_pyodide_rejects_invalid_builder_result(tmp_path: Path):
    config = dependency.DependencyConfig(PUBLISHED_REQUIREMENT, DEVELOPMENT_REF)
    invalid_artifact = tmp_path / "sigima-source.zip"
    invalid_artifact.touch()

    with pytest.raises(RuntimeError, match="invalid wheel path"):
        dependency.prepare_pyodide_snapshot(
            config,
            builder=lambda _requirement, _output: invalid_artifact,
        )


def test_wheel_builder_rejects_stale_output_before_running_commands(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    wheel_dir = tmp_path / "wheels"
    wheel_dir.mkdir()
    stale_wheel = wheel_dir / "sigima-1.2.0-py3-none-any.whl"
    stale_wheel.touch()

    def unexpected_run(*_args: str) -> None:
        raise AssertionError("no command should run while a stale wheel exists")

    monkeypatch.setattr(build_sigima_wheel, "run", unexpected_run)

    with pytest.raises(RuntimeError, match="Refusing to reuse"):
        build_sigima_wheel.build_wheel("sigima==1.3.0", wheel_dir)


def test_wheel_builder_only_rejects_stale_wheels_of_its_package(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    wheel_dir = tmp_path / "wheels"
    wheel_dir.mkdir()
    (wheel_dir / "sigima-1.3.0-py3-none-any.whl").touch()
    (wheel_dir / "guidata-3.15.0-py3-none-any.whl").touch()

    def unexpected_run(*_args: str) -> None:
        raise AssertionError("no command should run while a stale wheel exists")

    monkeypatch.setattr(build_sigima_wheel, "run", unexpected_run)

    with pytest.raises(RuntimeError, match="guidata-3.15.0") as excinfo:
        build_sigima_wheel.build_wheel("guidata>=3.15.0", wheel_dir, "guidata")
    assert "sigima-1.3.0" not in str(excinfo.value)
