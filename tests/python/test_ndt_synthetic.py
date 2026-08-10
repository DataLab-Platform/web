"""Tests for the explicitly limited synthetic NDT spike."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from scripts import ndt_synthetic

generate_synthetic_radiograph = ndt_synthetic.generate_synthetic_radiograph

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_ellipse_response_matches_declared_finite_geometry() -> None:
    """The injected response is zero at and beyond its declared boundary."""
    y_grid, x_grid = np.mgrid[:11, :11].astype(np.float64)
    response = ndt_synthetic._ellipse_response(
        x_grid,
        y_grid,
        center_x=5.0,
        center_y=5.0,
        radius_x=2.0,
        radius_y=1.0,
        angle_deg=0.0,
    )

    assert response[5, 5] == pytest.approx(1.0)
    assert 0.0 < response[5, 6] < 1.0
    assert response[5, 7] == 0.0
    assert response[5, 8] == 0.0
    assert response[4, 5] == 0.0


def test_synthetic_radiograph_is_deterministic_and_seeded() -> None:
    """The same seed reproduces pixels and truth while noise remains variable."""
    first_image, first_truth = generate_synthetic_radiograph(size=256, seed=42)
    second_image, second_truth = generate_synthetic_radiograph(size=256, seed=42)
    other_image, other_truth = generate_synthetic_radiograph(size=256, seed=43)

    assert first_image.dtype == np.uint16
    assert first_image.shape == (256, 256)
    np.testing.assert_array_equal(first_image, second_image)
    assert first_truth == second_truth
    assert not np.array_equal(first_image, other_image)
    assert first_truth["seed"] == 42
    assert other_truth["seed"] == 43


@pytest.mark.parametrize("size", [128, 256, 512])
def test_synthetic_truth_covers_the_spike_feature_matrix(size: int) -> None:
    """Truth records classes, varied geometry/contrast, overlap and artifacts."""
    image, truth = generate_synthetic_radiograph(size=size)
    indications = truth["indications"]

    assert image.shape == (size, size)
    assert len({entry["id"] for entry in indications}) == len(indications)
    assert {entry["class"] for entry in indications} == {"compact", "linear"}
    assert len({entry["contrast"] for entry in indications}) > 2
    assert len(
        {
            (
                entry["geometry"]["radius_x"],
                entry["geometry"]["radius_y"],
            )
            for entry in indications
        }
    ) == len(indications)
    assert truth["overlaps"] == [["compact-04", "compact-05"]]
    assert len(truth["artifacts"]["bad_pixels"]) == 8
    assert truth["purpose"] == "synthetic NDT spike only"
    for entry in indications:
        center_x = entry["position"]["x"]
        center_y = entry["position"]["y"]
        radius_x = entry["geometry"]["radius_x"]
        radius_y = entry["geometry"]["radius_y"]
        assert 0.0 <= center_x - radius_x < center_x + radius_x < size
        assert 0.0 <= center_y - radius_y < center_y + radius_y < size
    for index, pixel in enumerate(truth["artifacts"]["bad_pixels"]):
        expected_value = 0 if index % 2 == 0 else 24_000
        assert image[pixel["y"], pixel["x"]] == expected_value


def test_synthetic_radiograph_rejects_too_small_images() -> None:
    """The fixed feature matrix requires enough pixels to remain meaningful."""
    with pytest.raises(ValueError, match="at least 128"):
        generate_synthetic_radiograph(size=64)


def test_demo_workspace_preserves_synthetic_truth(fresh_bootstrap) -> None:
    """The shipped HDF5 demo preserves truth through the production loader."""
    workspace_path = REPO_ROOT / "public" / "demos" / "ndt.h5"
    counts = fresh_bootstrap.open_workspace_from_bytes(
        workspace_path.name, workspace_path.read_bytes(), replace=True
    )

    assert counts == {"signals": 0, "images": 1, "groups": 1}
    group = fresh_bootstrap.get_panel_tree("image")["groups"][0]
    assert group["name"] == "Synthetic NDT spike"
    image = group["objects"][0]
    assert image["title"] == "Synthetic radiograph (NDT spike)"

    metadata = {
        entry["key"]: entry["value"]
        for entry in fresh_bootstrap.list_object_metadata(image["id"])
    }
    truth = json.loads(metadata["spike.ndt.synthetic_truth"])
    assert truth["schema_version"] == 1
    assert {entry["class"] for entry in truth["indications"]} == {
        "compact",
        "linear",
    }
    assert metadata["spike.ndt.disclaimer"] == (
        "Synthetic algorithm-development data; not a qualified radiograph"
    )
