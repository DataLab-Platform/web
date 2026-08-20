"""Synthetic radiograph generator for the gated NDT spike.

This module produces algorithm-development data only. It does not model a
qualified radiographic acquisition and must not be used to claim inspection
performance or standards compliance.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray


def _ellipse_response(
    x_grid: NDArray[np.float64],
    y_grid: NDArray[np.float64],
    *,
    center_x: float,
    center_y: float,
    radius_x: float,
    radius_y: float,
    angle_deg: float,
) -> NDArray[np.float64]:
    """Return a smooth finite elliptical response with unit peak."""
    angle = np.deg2rad(angle_deg)
    cos_angle = np.cos(angle)
    sin_angle = np.sin(angle)
    x_offset = x_grid - center_x
    y_offset = y_grid - center_y
    x_rotated = cos_angle * x_offset + sin_angle * y_offset
    y_rotated = -sin_angle * x_offset + cos_angle * y_offset
    squared_radius = (x_rotated / radius_x) ** 2 + (y_rotated / radius_y) ** 2
    normalized_radius = np.sqrt(squared_radius)
    response = np.zeros_like(normalized_radius)
    inside = normalized_radius < 1.0
    response[inside] = 0.5 * (1.0 + np.cos(np.pi * normalized_radius[inside]))
    return response


def generate_synthetic_radiograph(
    *,
    size: int = 512,
    seed: int = 42,
) -> tuple[NDArray[np.uint16], dict[str, Any]]:
    """Generate a deterministic radiograph-like image and ground truth.

    Args:
        size: Width and height of the square image in pixels
        seed: Seed controlling detector noise and bad-pixel locations

    Returns:
        Unsigned 16-bit image and JSON-friendly spike ground truth
    """
    if size < 128:
        raise ValueError("Synthetic NDT image size must be at least 128 pixels")

    rng = np.random.default_rng(seed)
    y_grid, x_grid = np.mgrid[:size, :size].astype(np.float64)
    x_normalized = x_grid / (size - 1) * 2.0 - 1.0
    y_normalized = y_grid / (size - 1) * 2.0 - 1.0

    # Phenomenological brightness field (NOT Beer-Lambert attenuation):
    # indications carry negative contrast by convention of this spike.
    base_brightness = (
        13_000.0
        + 1_600.0 * x_normalized
        + 900.0 * y_normalized**2
        + 2_200.0 * np.exp(-0.5 * (x_normalized / 0.22) ** 2)
    )
    texture = 180.0 * np.sin(8.0 * x_normalized + 3.0 * y_normalized)
    data = base_brightness + texture
    # Signal-independent Gaussian noise only (no Poisson term) by design
    data += rng.normal(0.0, 120.0, size=(size, size))

    indication_specs = (
        ("compact-01", "compact", 0.27, 0.36, 0.018, 0.018, 0.0, -1_300.0),
        ("compact-02", "compact", 0.43, 0.58, 0.030, 0.019, 24.0, -2_600.0),
        ("compact-03", "compact", 0.63, 0.42, 0.015, 0.024, -18.0, -1_800.0),
        ("compact-04", "compact", 0.72, 0.69, 0.027, 0.022, 12.0, -2_300.0),
        ("compact-05", "compact", 0.75, 0.70, 0.023, 0.018, -10.0, -1_500.0),
        ("linear-01", "linear", 0.50, 0.28, 0.095, 0.009, 18.0, -1_000.0),
        ("linear-02", "linear", 0.36, 0.77, 0.065, 0.012, -35.0, -1_700.0),
    )
    indications: list[dict[str, Any]] = []
    footprints: list[tuple[str, NDArray[np.bool_]]] = []
    for (
        indication_id,
        indication_class,
        center_x_ratio,
        center_y_ratio,
        radius_x_ratio,
        radius_y_ratio,
        angle_deg,
        contrast,
    ) in indication_specs:
        center_x = center_x_ratio * (size - 1)
        center_y = center_y_ratio * (size - 1)
        radius_x = radius_x_ratio * size
        radius_y = radius_y_ratio * size
        response = _ellipse_response(
            x_grid,
            y_grid,
            center_x=center_x,
            center_y=center_y,
            radius_x=radius_x,
            radius_y=radius_y,
            angle_deg=angle_deg,
        )
        data += contrast * response
        footprints.append((indication_id, response > 0.0))
        indications.append(
            {
                "id": indication_id,
                "class": indication_class,
                "position": {"x": center_x, "y": center_y},
                "geometry": {
                    "shape": "ellipse",
                    "radius_x": radius_x,
                    "radius_y": radius_y,
                    "angle_deg": angle_deg,
                },
                "contrast": contrast,
            }
        )

    stripe_column = round(0.12 * (size - 1))
    data[:, stripe_column : stripe_column + 2] += 700.0
    band_row = round(0.84 * (size - 1))
    data[band_row : band_row + 2, :] -= 450.0
    # Derived from rendered footprints so the truth cannot drift from the specs
    overlaps = [
        [first_id, second_id]
        for index, (first_id, first_mask) in enumerate(footprints)
        for second_id, second_mask in footprints[index + 1 :]
        if bool(np.any(first_mask & second_mask))
    ]
    bad_pixels = []
    for index in range(8):
        pixel_y = int(rng.integers(0, size))
        pixel_x = int(rng.integers(0, size))
        data[pixel_y, pixel_x] = 0.0 if index % 2 == 0 else 24_000.0
        bad_pixels.append({"x": pixel_x, "y": pixel_y})

    truth: dict[str, Any] = {
        "schema_version": 1,
        "purpose": "synthetic NDT spike only",
        "seed": seed,
        "image_size": [size, size],
        "indications": indications,
        "overlaps": overlaps,
        "artifacts": {
            "vertical_gain_stripe_columns": [stripe_column, stripe_column + 1],
            "horizontal_band_rows": [band_row, band_row + 1],
            "bad_pixels": bad_pixels,
        },
    }
    image = np.clip(np.rint(data), 0, np.iinfo(np.uint16).max).astype(np.uint16)
    return image, truth


__all__ = ["generate_synthetic_radiograph"]
