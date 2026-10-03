# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import capsule_dependency as dependency

DEVELOPMENT_REF = "c950dfcd1214a8feb2e8ee36de12ce61cc2be435"


def write_manifest(path: Path, published: object, development_ref: object) -> Path:
    """Write a dependency manifest for one test."""
    path.write_text(
        json.dumps(
            {"publishedRequirement": published, "developmentRef": development_ref}
        ),
        encoding="utf-8",
    )
    return path


def test_repository_manifest_is_valid() -> None:
    dependency.load_config()


def test_unpublished_without_ref_installs_nothing(tmp_path: Path) -> None:
    config = dependency.load_config(write_manifest(tmp_path / "m.json", None, None))
    assert config.requirement is None
    assert dependency.prepare_pyodide(config, wheel_dir=tmp_path / "w") is None


def test_development_ref_takes_priority(tmp_path: Path) -> None:
    config = dependency.load_config(
        write_manifest(tmp_path / "m.json", "datalab-capsule==0.1.0", DEVELOPMENT_REF)
    )
    assert config.requirement == (
        "datalab-capsule @ https://github.com/DataLab-Platform/DataLab-Capsule/"
        f"archive/{DEVELOPMENT_REF}.zip"
    )


@pytest.mark.parametrize(
    ("published", "ref"),
    [("datalab-capsule>=0.1", None), (None, "abc"), ("sigima==1.3.0", None)],
)
def test_invalid_manifests_are_refused(tmp_path: Path, published, ref) -> None:
    with pytest.raises(dependency.DependencyConfigError):
        dependency.load_config(write_manifest(tmp_path / "m.json", published, ref))
