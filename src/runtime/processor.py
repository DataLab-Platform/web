# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Generic processor & feature catalogue for DataLab-Web.

Mirrors :mod:`datalab.gui.processor.base` and friends, scaled down for the
browser MVP.  Three computation patterns are exposed:

* ``1_to_1`` — one source object → one result object (loop on selection).
* ``2_to_1`` — one source + one operand → one result (loop on selection).
* ``n_to_1`` — N source objects → one result (single call on selection).

Features are discovered automatically by introspecting Sigima's
``@computation_function`` decorated callables.  The pattern is inferred
from the function signature (first positional parameter type:
``SignalObj`` → 1_to_1 or 2_to_1, ``list[SignalObj]`` → n_to_1).

Manual ``OVERRIDES`` complete the catalogue with curated labels, icons,
menu locations and pattern overrides.  Functions without an override are
hidden by default — Sigima exposes far more callables than make sense in
a browser menu.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
import typing
from dataclasses import dataclass, field
from typing import Any, Callable

import guidata.dataset as gds
from guidata.dataset import (
    dataset_to_schema_with_values,
    resolve_dataset_callbacks,
    resolve_dynamic_choices,
    update_dataset,
)
from sigima.objects import ImageObj, SignalObj
from sigima.proc.decorator import (
    is_computation_function,
)

Pattern = str  # "1_to_1" | "2_to_1" | "n_to_1"


# ---------------------------------------------------------------------------
# Catalogue declaration
# ---------------------------------------------------------------------------


@dataclass
class FeatureOverride:
    """Curated metadata complementing auto-discovered Sigima functions."""

    label: str
    menu_path: str  # "Operations/Difference"
    pattern: Pattern | None = None  # auto-detected if None
    icon: str | None = None
    operand_label: str = "Operand"
    skip_xarray_compat: bool = False
    # Destination panel for results.  ``None`` means "same as input panel"
    # (the default for the vast majority of features).  Set to e.g.
    # ``"signal"`` on an image feature whose result is a signal
    # (line/segment/average/radial profile, projections, image histogram)
    # or to ``"image"`` on a signal feature whose result is an image
    # (``signals_to_image``).
    output_kind: str | None = None


@dataclass
class FeatureSpec:
    """A fully resolved feature ready for the front-end."""

    feature_id: str
    label: str
    menu_path: str
    pattern: Pattern
    icon: str | None
    operand_label: str
    paramclass: type[gds.DataSet] | None
    func: Callable[..., Any]
    object_kind: str = "signal"
    skip_xarray_compat: bool = False
    # Resolved at catalog-build time (defaults to ``object_kind``).
    output_kind: str = "signal"


# Curated catalogue.  Keys must match the Sigima function name.  Functions
# not listed here are hidden from the menu (still accessible via
# ``apply_feature`` if their id is known — we don't enforce a guard).
#
# Iteration order matters: it drives the on-screen order of menu entries
# (and of submenu first-appearance positions).  Keep entries grouped and
# ordered to mirror the desktop DataLab Qt app — see
# ``register_*`` calls in ``datalab/gui/processor/signal.py``.
SIGNAL_OVERRIDES: dict[str, FeatureOverride] = {
    # ----- Operations menu (Qt order) -----------------------------------
    "arithmetic": FeatureOverride(
        "Arithmetic…",
        "Operations/Arithmetic",
        operand_label="Second signal",
    ),
    # Operations / Constant ----------------------------------------------
    "addition_constant": FeatureOverride(
        "Add constant…", "Operations/Constant/Add constant"
    ),
    "difference_constant": FeatureOverride(
        "Subtract constant…", "Operations/Constant/Subtract constant"
    ),
    "product_constant": FeatureOverride(
        "Multiply by constant…", "Operations/Constant/Multiply by constant"
    ),
    "division_constant": FeatureOverride(
        "Divide by constant…", "Operations/Constant/Divide by constant"
    ),
    # Operations (continued, Qt order) -----------------------------------
    "addition": FeatureOverride("Sum", "Operations/Sum"),
    "difference": FeatureOverride(
        "Difference", "Operations/Difference", operand_label="Signal to subtract"
    ),
    "product": FeatureOverride("Product", "Operations/Product"),
    "division": FeatureOverride(
        "Division", "Operations/Division", operand_label="Divisor"
    ),
    "inverse": FeatureOverride("Inverse", "Operations/Inverse"),
    "exp": FeatureOverride("Exponential", "Operations/Exponential"),
    "log10": FeatureOverride("Logarithm (base 10)", "Operations/Logarithm (base 10)"),
    "power": FeatureOverride("Power…", "Operations/Power"),
    "sqrt": FeatureOverride("Square root", "Operations/Square root"),
    "absolute": FeatureOverride("Absolute value", "Operations/Absolute value"),
    "phase": FeatureOverride("Phase…", "Operations/Phase"),
    "complex_from_magnitude_phase": FeatureOverride(
        "Combine with phase…",
        "Operations/Combine with phase",
        operand_label="Phase signal",
    ),
    "real": FeatureOverride("Real part", "Operations/Real part"),
    "imag": FeatureOverride("Imaginary part", "Operations/Imaginary part"),
    "complex_from_real_imag": FeatureOverride(
        "Combine with imaginary part",
        "Operations/Combine with imaginary part",
        operand_label="Imaginary part signal",
    ),
    "astype": FeatureOverride("Convert data type…", "Operations/Convert data type"),
    "average": FeatureOverride("Average", "Operations/Average"),
    "standard_deviation": FeatureOverride(
        "Standard deviation", "Operations/Standard deviation"
    ),
    "quadratic_difference": FeatureOverride(
        "Quadratic difference",
        "Operations/Quadratic difference",
        operand_label="Signal to subtract",
    ),
    "convolution": FeatureOverride(
        "Convolution",
        "Operations/Convolution",
        operand_label="Convolution kernel",
    ),
    "deconvolution": FeatureOverride(
        "Deconvolution",
        "Operations/Deconvolution",
        operand_label="Deconvolution kernel",
    ),
    # Cross-kind: signals → image (n_to_1).
    "signals_to_image": FeatureOverride(
        "Assemble signals into image…",
        "Operations/Assemble signals into image",
        pattern="n_to_1",
        output_kind="image",
    ),
    # ----- Processing menu (Qt order) -----------------------------------
    # Processing / Axis transformation -----------------------------------
    "calibration": FeatureOverride(
        "Linear calibration…",
        "Processing/Axis transformation/Linear calibration",
    ),
    "transpose": FeatureOverride(
        "Swap X/Y axes", "Processing/Axis transformation/Swap X/Y axes"
    ),
    "reverse_x": FeatureOverride(
        "Reverse X-axis", "Processing/Axis transformation/Reverse X-axis"
    ),
    "replace_x_by_other_y": FeatureOverride(
        "Replace X by other signal's Y",
        "Processing/Axis transformation/Replace X by other signal's Y",
        operand_label="Signal whose Y becomes the X axis",
        skip_xarray_compat=True,
    ),
    "xy_mode": FeatureOverride(
        "X-Y mode",
        "Processing/Axis transformation/X-Y mode",
        skip_xarray_compat=True,
    ),
    "to_cartesian": FeatureOverride(
        "Convert to cartesian coordinates…",
        "Processing/Axis transformation/Convert to cartesian coordinates",
    ),
    "to_polar": FeatureOverride(
        "Convert to polar coordinates…",
        "Processing/Axis transformation/Convert to polar coordinates",
    ),
    # Processing / Level adjustment --------------------------------------
    "normalize": FeatureOverride("Normalize…", "Processing/Level adjustment/Normalize"),
    "clip": FeatureOverride("Clipping…", "Processing/Level adjustment/Clipping"),
    "offset_correction": FeatureOverride(
        "Offset correction", "Processing/Level adjustment/Offset correction"
    ),
    # Processing / Noise addition ----------------------------------------
    "add_gaussian_noise": FeatureOverride(
        "Add Gaussian noise…", "Processing/Noise addition/Add Gaussian noise"
    ),
    "add_poisson_noise": FeatureOverride(
        "Add Poisson noise…", "Processing/Noise addition/Add Poisson noise"
    ),
    "add_uniform_noise": FeatureOverride(
        "Add uniform noise…", "Processing/Noise addition/Add uniform noise"
    ),
    # Processing / Noise reduction ---------------------------------------
    "gaussian_filter": FeatureOverride(
        "Gaussian filter…", "Processing/Noise reduction/Gaussian filter"
    ),
    "moving_average": FeatureOverride(
        "Moving average…", "Processing/Noise reduction/Moving average"
    ),
    "moving_median": FeatureOverride(
        "Moving median…", "Processing/Noise reduction/Moving median"
    ),
    "wiener": FeatureOverride(
        "Wiener filter", "Processing/Noise reduction/Wiener filter"
    ),
    # Processing / Fourier analysis --------------------------------------
    "zero_padding": FeatureOverride(
        "Zero padding…", "Processing/Fourier analysis/Zero padding"
    ),
    "fft": FeatureOverride("FFT", "Processing/Fourier analysis/FFT"),
    "ifft": FeatureOverride("Inverse FFT", "Processing/Fourier analysis/Inverse FFT"),
    "magnitude_spectrum": FeatureOverride(
        "Magnitude spectrum", "Processing/Fourier analysis/Magnitude spectrum"
    ),
    "phase_spectrum": FeatureOverride(
        "Phase spectrum", "Processing/Fourier analysis/Phase spectrum"
    ),
    "psd": FeatureOverride("PSD", "Processing/Fourier analysis/Power spectral density"),
    # Processing / Frequency filters -------------------------------------
    "lowpass": FeatureOverride(
        "Low-pass filter…", "Processing/Frequency filters/Low-pass filter"
    ),
    "highpass": FeatureOverride(
        "High-pass filter…", "Processing/Frequency filters/High-pass filter"
    ),
    "bandpass": FeatureOverride(
        "Band-pass filter…", "Processing/Frequency filters/Band-pass filter"
    ),
    "bandstop": FeatureOverride(
        "Band-stop filter…", "Processing/Frequency filters/Band-stop filter"
    ),
    # Processing / Fitting -----------------------------------------------
    "linear_fit": FeatureOverride("Linear fit", "Processing/Fitting/Linear fit"),
    "polynomial_fit": FeatureOverride(
        "Polynomial fit…", "Processing/Fitting/Polynomial fit"
    ),
    "gaussian_fit": FeatureOverride("Gaussian fit", "Processing/Fitting/Gaussian fit"),
    "lorentzian_fit": FeatureOverride(
        "Lorentzian fit", "Processing/Fitting/Lorentzian fit"
    ),
    "voigt_fit": FeatureOverride("Voigt fit", "Processing/Fitting/Voigt fit"),
    "planckian_fit": FeatureOverride(
        "Planckian fit", "Processing/Fitting/Planckian fit"
    ),
    "twohalfgaussian_fit": FeatureOverride(
        "Two Half-Gaussians fit", "Processing/Fitting/Two Half-Gaussians fit"
    ),
    "piecewiseexponential_fit": FeatureOverride(
        "Piecewise exponential fit",
        "Processing/Fitting/Piecewise exponential fit",
    ),
    "exponential_fit": FeatureOverride(
        "Exponential fit", "Processing/Fitting/Exponential fit"
    ),
    "sinusoidal_fit": FeatureOverride(
        "Sinusoidal fit", "Processing/Fitting/Sinusoidal fit"
    ),
    "cdf_fit": FeatureOverride("CDF fit", "Processing/Fitting/CDF fit"),
    "sigmoid_fit": FeatureOverride("Sigmoid fit", "Processing/Fitting/Sigmoid fit"),
    "evaluate_fit": FeatureOverride(
        "Evaluate fit",
        "Processing/Fitting/Evaluate fit",
        operand_label="Fit signal",
        skip_xarray_compat=True,
    ),
    # Processing (top-level entries, Qt order) ---------------------------
    "derivative": FeatureOverride("Derivative", "Processing/Derivative"),
    "integral": FeatureOverride("Integral", "Processing/Integral"),
    "apply_window": FeatureOverride("Windowing…", "Processing/Windowing"),
    "detrending": FeatureOverride("Detrending…", "Processing/Detrending"),
    "interpolate": FeatureOverride("Interpolation…", "Processing/Interpolation"),
    "resampling": FeatureOverride("Resampling…", "Processing/Resampling"),
    # Processing / Stability analysis ------------------------------------
    "allan_variance": FeatureOverride(
        "Allan variance…", "Processing/Stability analysis/Allan variance"
    ),
    "allan_deviation": FeatureOverride(
        "Allan deviation…", "Processing/Stability analysis/Allan deviation"
    ),
    "modified_allan_variance": FeatureOverride(
        "Modified Allan variance…",
        "Processing/Stability analysis/Modified Allan variance",
    ),
    "hadamard_variance": FeatureOverride(
        "Hadamard variance…", "Processing/Stability analysis/Hadamard variance"
    ),
    "total_variance": FeatureOverride(
        "Total variance…", "Processing/Stability analysis/Total variance"
    ),
    "time_deviation": FeatureOverride(
        "Time deviation…", "Processing/Stability analysis/Time deviation"
    ),
    # ----- Analysis menu (Qt order) -------------------------------------
    "histogram": FeatureOverride("Histogram…", "Analysis/Histogram"),
    "peak_detection": FeatureOverride("Peak detection…", "Analysis/Peak detection"),
}


# Curated image catalogue.  Same conventions as ``SIGNAL_OVERRIDES``;
# iteration order mirrors the DataLab Qt image menus — see
# ``register_*`` calls in ``datalab/gui/processor/image.py``.
IMAGE_OVERRIDES: dict[str, FeatureOverride] = {
    # ----- Operations menu (Qt order) -----------------------------------
    "arithmetic": FeatureOverride(
        "Arithmetic…",
        "Operations/Arithmetic",
        operand_label="Second image",
    ),
    # Operations / Constant ----------------------------------------------
    "addition_constant": FeatureOverride(
        "Add constant…", "Operations/Constant/Add constant"
    ),
    "difference_constant": FeatureOverride(
        "Subtract constant…", "Operations/Constant/Subtract constant"
    ),
    "product_constant": FeatureOverride(
        "Multiply by constant…", "Operations/Constant/Multiply by constant"
    ),
    "division_constant": FeatureOverride(
        "Divide by constant…", "Operations/Constant/Divide by constant"
    ),
    # Operations (continued, Qt order) -----------------------------------
    "addition": FeatureOverride("Sum", "Operations/Sum"),
    "difference": FeatureOverride(
        "Difference", "Operations/Difference", operand_label="Image to subtract"
    ),
    "product": FeatureOverride("Product", "Operations/Product"),
    "division": FeatureOverride(
        "Division", "Operations/Division", operand_label="Divisor"
    ),
    "inverse": FeatureOverride("Inverse", "Operations/Inverse"),
    "exp": FeatureOverride("Exponential", "Operations/Exponential"),
    "log10": FeatureOverride("Logarithm (base 10)", "Operations/Logarithm (base 10)"),
    "log10_z_plus_n": FeatureOverride("Log10(z+n)…", "Operations/Log10(z+n)"),
    "absolute": FeatureOverride("Absolute value", "Operations/Absolute value"),
    "phase": FeatureOverride("Phase…", "Operations/Phase"),
    "complex_from_magnitude_phase": FeatureOverride(
        "Combine with phase…",
        "Operations/Combine with phase",
        operand_label="Phase image",
    ),
    "real": FeatureOverride("Real part", "Operations/Real part"),
    "imag": FeatureOverride("Imaginary part", "Operations/Imaginary part"),
    "complex_from_real_imag": FeatureOverride(
        "Combine with imaginary part",
        "Operations/Combine with imaginary part",
        operand_label="Imaginary part image",
    ),
    "astype": FeatureOverride("Convert data type…", "Operations/Convert data type"),
    "average": FeatureOverride("Average", "Operations/Average"),
    "standard_deviation": FeatureOverride(
        "Standard deviation", "Operations/Standard deviation"
    ),
    "quadratic_difference": FeatureOverride(
        "Quadratic difference",
        "Operations/Quadratic difference",
        operand_label="Image to subtract",
    ),
    "convolution": FeatureOverride(
        "Convolution",
        "Operations/Convolution",
        operand_label="Convolution kernel",
    ),
    "deconvolution": FeatureOverride(
        "Deconvolution",
        "Operations/Deconvolution",
        operand_label="Deconvolution kernel",
    ),
    "flatfield": FeatureOverride(
        "Flat-field correction…",
        "Operations/Flat-field correction",
        operand_label="Flat-field image",
    ),
    # ----- Processing menu (Qt order) -----------------------------------
    # Processing / Geometry ----------------------------------------------
    "fliph": FeatureOverride(
        "Flip horizontally", "Processing/Geometry/Flip horizontally"
    ),
    "transpose": FeatureOverride(
        "Flip diagonally", "Processing/Geometry/Flip diagonally"
    ),
    "flipv": FeatureOverride("Flip vertically", "Processing/Geometry/Flip vertically"),
    "rotate90": FeatureOverride(
        "Rotate 90° right", "Processing/Geometry/Rotate 90° right"
    ),
    "rotate270": FeatureOverride(
        "Rotate 90° left", "Processing/Geometry/Rotate 90° left"
    ),
    "rotate": FeatureOverride("Rotate by…", "Processing/Geometry/Rotate by"),
    "translate": FeatureOverride("Translate…", "Processing/Geometry/Translate"),
    # Processing / Axis transformation -----------------------------------
    "set_uniform_coords": FeatureOverride(
        "Set uniform coordinates…",
        "Processing/Axis transformation/Set uniform coordinates",
    ),
    "calibration": FeatureOverride(
        "Polynomial calibration…",
        "Processing/Axis transformation/Polynomial calibration",
    ),
    # Processing / Level adjustment --------------------------------------
    "normalize": FeatureOverride("Normalize…", "Processing/Level adjustment/Normalize"),
    "clip": FeatureOverride("Clipping…", "Processing/Level adjustment/Clipping"),
    "offset_correction": FeatureOverride(
        "Offset correction", "Processing/Level adjustment/Offset correction"
    ),
    # Processing / Noise addition ----------------------------------------
    "add_gaussian_noise": FeatureOverride(
        "Add Gaussian noise…", "Processing/Noise addition/Add Gaussian noise"
    ),
    "add_poisson_noise": FeatureOverride(
        "Add Poisson noise…", "Processing/Noise addition/Add Poisson noise"
    ),
    "add_uniform_noise": FeatureOverride(
        "Add uniform noise…", "Processing/Noise addition/Add uniform noise"
    ),
    # Processing / Noise reduction ---------------------------------------
    "gaussian_filter": FeatureOverride(
        "Gaussian filter…", "Processing/Noise reduction/Gaussian filter"
    ),
    "moving_average": FeatureOverride(
        "Moving average…", "Processing/Noise reduction/Moving average"
    ),
    "moving_median": FeatureOverride(
        "Moving median…", "Processing/Noise reduction/Moving median"
    ),
    "wiener": FeatureOverride(
        "Wiener filter", "Processing/Noise reduction/Wiener filter"
    ),
    # Processing / Fourier analysis --------------------------------------
    "zero_padding": FeatureOverride(
        "Zero padding…", "Processing/Fourier analysis/Zero padding"
    ),
    "fft": FeatureOverride("FFT", "Processing/Fourier analysis/FFT"),
    "ifft": FeatureOverride("Inverse FFT", "Processing/Fourier analysis/Inverse FFT"),
    "magnitude_spectrum": FeatureOverride(
        "Magnitude spectrum", "Processing/Fourier analysis/Magnitude spectrum"
    ),
    "phase_spectrum": FeatureOverride(
        "Phase spectrum", "Processing/Fourier analysis/Phase spectrum"
    ),
    "psd": FeatureOverride("PSD", "Processing/Fourier analysis/Power spectral density"),
    # Processing / Frequency filters -------------------------------------
    "butterworth": FeatureOverride(
        "Butterworth…", "Processing/Frequency filters/Butterworth"
    ),
    "gaussian_freq_filter": FeatureOverride(
        "Gaussian bandpass…",
        "Processing/Frequency filters/Gaussian bandpass",
    ),
    # Processing / Thresholding ------------------------------------------
    "threshold": FeatureOverride(
        "Parametric thresholding…",
        "Processing/Thresholding/Parametric thresholding",
    ),
    "threshold_isodata": FeatureOverride(
        "ISODATA thresholding", "Processing/Thresholding/ISODATA thresholding"
    ),
    "threshold_li": FeatureOverride(
        "Li thresholding", "Processing/Thresholding/Li thresholding"
    ),
    "threshold_mean": FeatureOverride(
        "Mean thresholding", "Processing/Thresholding/Mean thresholding"
    ),
    "threshold_minimum": FeatureOverride(
        "Minimum thresholding", "Processing/Thresholding/Minimum thresholding"
    ),
    "threshold_otsu": FeatureOverride(
        "Otsu thresholding", "Processing/Thresholding/Otsu thresholding"
    ),
    "threshold_triangle": FeatureOverride(
        "Triangle thresholding", "Processing/Thresholding/Triangle thresholding"
    ),
    "threshold_yen": FeatureOverride(
        "Yen thresholding", "Processing/Thresholding/Yen thresholding"
    ),
    # Processing / Exposure ----------------------------------------------
    "adjust_gamma": FeatureOverride(
        "Gamma correction…", "Processing/Exposure/Gamma correction"
    ),
    "adjust_log": FeatureOverride(
        "Logarithmic correction…",
        "Processing/Exposure/Logarithmic correction",
    ),
    "adjust_sigmoid": FeatureOverride(
        "Sigmoid correction…", "Processing/Exposure/Sigmoid correction"
    ),
    "equalize_hist": FeatureOverride(
        "Histogram equalization…",
        "Processing/Exposure/Histogram equalization",
    ),
    "equalize_adapthist": FeatureOverride(
        "Adaptive histogram equalization…",
        "Processing/Exposure/Adaptive histogram equalization",
    ),
    "rescale_intensity": FeatureOverride(
        "Intensity rescaling…",
        "Processing/Exposure/Intensity rescaling",
    ),
    # Processing / Restoration -------------------------------------------
    "denoise_tv": FeatureOverride(
        "Total variation denoising…",
        "Processing/Restoration/Total variation denoising",
    ),
    "denoise_bilateral": FeatureOverride(
        "Bilateral filter denoising…",
        "Processing/Restoration/Bilateral filter denoising",
    ),
    "denoise_wavelet": FeatureOverride(
        "Wavelet denoising…",
        "Processing/Restoration/Wavelet denoising",
    ),
    "denoise_tophat": FeatureOverride(
        "White Top-Hat denoising…",
        "Processing/Restoration/White Top-Hat denoising",
    ),
    # Processing / Morphology --------------------------------------------
    "white_tophat": FeatureOverride(
        "White Top-Hat (disk)…",
        "Processing/Morphology/White Top-Hat (disk)",
    ),
    "black_tophat": FeatureOverride(
        "Black Top-Hat (disk)…",
        "Processing/Morphology/Black Top-Hat (disk)",
    ),
    "erosion": FeatureOverride(
        "Erosion (disk)…", "Processing/Morphology/Erosion (disk)"
    ),
    "dilation": FeatureOverride(
        "Dilation (disk)…", "Processing/Morphology/Dilation (disk)"
    ),
    "opening": FeatureOverride(
        "Opening (disk)…", "Processing/Morphology/Opening (disk)"
    ),
    "closing": FeatureOverride(
        "Closing (disk)…", "Processing/Morphology/Closing (disk)"
    ),
    # Processing / Edge detection (Qt order: alphabetical, h/v after main) -
    "canny": FeatureOverride("Canny filter…", "Processing/Edge detection/Canny filter"),
    "farid": FeatureOverride("Farid filter", "Processing/Edge detection/Farid filter"),
    "farid_h": FeatureOverride(
        "Farid filter (horizontal)",
        "Processing/Edge detection/Farid filter (horizontal)",
    ),
    "farid_v": FeatureOverride(
        "Farid filter (vertical)",
        "Processing/Edge detection/Farid filter (vertical)",
    ),
    "laplace": FeatureOverride(
        "Laplace filter", "Processing/Edge detection/Laplace filter"
    ),
    "prewitt": FeatureOverride(
        "Prewitt filter", "Processing/Edge detection/Prewitt filter"
    ),
    "prewitt_h": FeatureOverride(
        "Prewitt filter (horizontal)",
        "Processing/Edge detection/Prewitt filter (horizontal)",
    ),
    "prewitt_v": FeatureOverride(
        "Prewitt filter (vertical)",
        "Processing/Edge detection/Prewitt filter (vertical)",
    ),
    "roberts": FeatureOverride(
        "Roberts filter", "Processing/Edge detection/Roberts filter"
    ),
    "scharr": FeatureOverride(
        "Scharr filter", "Processing/Edge detection/Scharr filter"
    ),
    "scharr_h": FeatureOverride(
        "Scharr filter (horizontal)",
        "Processing/Edge detection/Scharr filter (horizontal)",
    ),
    "scharr_v": FeatureOverride(
        "Scharr filter (vertical)",
        "Processing/Edge detection/Scharr filter (vertical)",
    ),
    "sobel": FeatureOverride("Sobel filter", "Processing/Edge detection/Sobel filter"),
    "sobel_h": FeatureOverride(
        "Sobel filter (horizontal)",
        "Processing/Edge detection/Sobel filter (horizontal)",
    ),
    "sobel_v": FeatureOverride(
        "Sobel filter (vertical)",
        "Processing/Edge detection/Sobel filter (vertical)",
    ),
    # Processing (top-level entries, Qt order) ---------------------------
    "resize": FeatureOverride("Resize…", "Processing/Resize"),
    "binning": FeatureOverride("Pixel binning…", "Processing/Pixel binning"),
    "resampling": FeatureOverride("Resampling…", "Processing/Resampling"),
    # ----- Analysis menu (Qt order) -------------------------------------
    "histogram": FeatureOverride(
        "Histogram…",
        "Analysis/Histogram",
        output_kind="signal",
    ),
    # Analysis / Intensity profiles (cross-kind: image → signal) ---------
    "line_profile": FeatureOverride(
        "Line profile…",
        "Analysis/Intensity profiles/Line profile",
        output_kind="signal",
    ),
    "segment_profile": FeatureOverride(
        "Segment profile…",
        "Analysis/Intensity profiles/Segment profile",
        output_kind="signal",
    ),
    "average_profile": FeatureOverride(
        "Average profile…",
        "Analysis/Intensity profiles/Average profile",
        output_kind="signal",
    ),
    "radial_profile": FeatureOverride(
        "Radial profile extraction…",
        "Analysis/Intensity profiles/Radial profile extraction",
        output_kind="signal",
    ),
    "horizontal_projection": FeatureOverride(
        "Horizontal projection",
        "Analysis/Horizontal projection",
        output_kind="signal",
    ),
    "vertical_projection": FeatureOverride(
        "Vertical projection",
        "Analysis/Vertical projection",
        output_kind="signal",
    ),
}


# ---------------------------------------------------------------------------
# Pattern inference
# ---------------------------------------------------------------------------


def _is_signal_type(annot: Any) -> bool:
    if isinstance(annot, type) and issubclass(annot, SignalObj):
        return True
    if isinstance(annot, str):
        return annot in {"SignalObj", "sigima.objects.SignalObj"}
    return False


def _is_signal_list_type(annot: Any) -> bool:
    origin = typing.get_origin(annot)
    if origin in (list, typing.List):  # type: ignore[attr-defined]
        args = typing.get_args(annot)
        return bool(args) and _is_signal_type(args[0])
    if isinstance(annot, str):
        return annot in {"list[SignalObj]", "List[SignalObj]"}
    return False


def _is_image_type(annot: Any) -> bool:
    if isinstance(annot, type) and issubclass(annot, ImageObj):
        return True
    if isinstance(annot, str):
        return annot in {"ImageObj", "sigima.objects.ImageObj"}
    return False


def _is_image_list_type(annot: Any) -> bool:
    origin = typing.get_origin(annot)
    if origin in (list, typing.List):  # type: ignore[attr-defined]
        args = typing.get_args(annot)
        return bool(args) and _is_image_type(args[0])
    if isinstance(annot, str):
        return annot in {"list[ImageObj]", "List[ImageObj]"}
    return False


def _is_obj_type(annot: Any, kind: str) -> bool:
    return _is_image_type(annot) if kind == "image" else _is_signal_type(annot)


def _is_obj_list_type(annot: Any, kind: str) -> bool:
    return (
        _is_image_list_type(annot) if kind == "image" else _is_signal_list_type(annot)
    )


def _extract_paramclass(func: Callable[..., Any]) -> type[gds.DataSet] | None:
    """Return the DataSet parameter class of *func*, if any."""
    try:
        hints = typing.get_type_hints(func)
    except Exception:  # pylint: disable=broad-except
        hints = {}
    sig = inspect.signature(func)
    func_module = inspect.getmodule(func)
    func_globals = getattr(func_module, "__dict__", {}) if func_module else {}
    for p in sig.parameters.values():
        annot = hints.get(p.name, p.annotation)
        if isinstance(annot, str):
            annot = func_globals.get(annot, annot)
        if (
            _is_signal_type(annot)
            or _is_signal_list_type(annot)
            or _is_image_type(annot)
            or _is_image_list_type(annot)
        ):
            continue
        if (
            isinstance(annot, type)
            and issubclass(annot, gds.DataSet)
            and annot is not gds.DataSet
        ):
            return annot
    return None


def _infer_pattern(func: Callable[..., Any], kind: str = "signal") -> Pattern | None:
    """Infer the computation pattern from the function's signature.

    Returns ``None`` if the signature does not match a supported pattern.
    """
    try:
        hints = typing.get_type_hints(func)
    except Exception:  # pylint: disable=broad-except
        hints = {}
    sig = inspect.signature(func)
    params = list(sig.parameters.values())
    if not params:
        return None
    first_annot = hints.get(params[0].name, params[0].annotation)
    if _is_obj_list_type(first_annot, kind):
        return "n_to_1"
    if _is_obj_type(first_annot, kind):
        if len(params) >= 2:
            second_annot = hints.get(params[1].name, params[1].annotation)
            if _is_obj_type(second_annot, kind):
                return "2_to_1"
        return "1_to_1"
    return None


# ---------------------------------------------------------------------------
# Catalogue building
# ---------------------------------------------------------------------------


def _collect_functions_for_kind(kind: str) -> dict[str, Callable[..., Any]]:
    """Return ``{function_name: callable}`` for every Sigima computation
    in ``sigima.proc.<kind>``.

    Walks the package only — avoids importing ``sigima.proc.validation``
    which depends on ``pytest`` (not available in the default Pyodide
    stack).
    """
    pkg = importlib.import_module(f"sigima.proc.{kind}")

    result: dict[str, Callable[..., Any]] = {}
    seen: set[int] = set()
    for _finder, modname, _ispkg in pkgutil.walk_packages(
        path=pkg.__path__, prefix=pkg.__name__ + "."
    ):
        try:
            mod = importlib.import_module(modname)
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[processor] skip module {modname!r}: {exc}")
            continue
        for name, func in inspect.getmembers(mod, inspect.isfunction):
            if not is_computation_function(func):
                continue
            if id(func) in seen:
                continue
            seen.add(id(func))
            result.setdefault(name, func)
    return result


def _collect_signal_functions() -> dict[str, Callable[..., Any]]:
    """Backwards-compatible alias for :func:`_collect_functions_for_kind`."""
    return _collect_functions_for_kind("signal")


# Feature → SVG icon defaults applied when ``FeatureOverride.icon`` is None.
# Mirrors ``register_*(..., icon_name=...)`` calls in DataLab desktop's
# ``gui/processor/{signal,image}.py``.  Keys are feature ids (i.e. Sigima
# function names); values are bare SVG filenames resolved client-side via
# :file:`src/assets/featureIcons.ts`.
#
# When a feature has no individual desktop icon, we fall back to the icon
# of its parent sub-menu (e.g. all "Noise reduction" filters share
# ``noise_reduction.svg``) so menus remain visually consistent.
_FEATURE_ICON_DEFAULTS: dict[str, str] = {
    # Operations / arithmetic --------------------------------------------
    "addition": "sum.svg",
    "average": "average.svg",
    "product": "product.svg",
    "difference": "difference.svg",
    "quadratic_difference": "quadratic_difference.svg",
    "division": "division.svg",
    "standard_deviation": "std.svg",
    "arithmetic": "arithmetic.svg",
    "inverse": "inverse.svg",
    "absolute": "abs.svg",
    "real": "re.svg",
    "imag": "im.svg",
    "phase": "phase.svg",
    "complex_from_magnitude_phase": "complex_from_magnitude_phase.svg",
    "complex_from_real_imag": "complex_from_real_imag.svg",
    "astype": "convert_dtype.svg",
    "convolution": "convolution.svg",
    "deconvolution": "deconvolution.svg",
    "signals_to_image": "signals_to_image.svg",
    # Operations / Constant ----------------------------------------------
    "addition_constant": "constant_add.svg",
    "difference_constant": "constant_subtract.svg",
    "product_constant": "constant_multiply.svg",
    "division_constant": "constant_divide.svg",
    # Operations / Math --------------------------------------------------
    "exp": "exp.svg",
    "log10": "log10.svg",
    "log10_z_plus_n": "log10.svg",
    "sqrt": "sqrt.svg",
    "power": "power.svg",
    # Processing / Axis transformation -----------------------------------
    "calibration": "axis_transform.svg",
    "xy_mode": "axis_transform.svg",
    "reverse_x": "reverse_signal_x.svg",
    "replace_x_by_other_y": "axis_transform.svg",
    "to_cartesian": "axis_transform.svg",
    "to_polar": "axis_transform.svg",
    "transpose": "swap_x_y.svg",
    "set_uniform_coords": "axis_transform.svg",
    # Processing / Geometry ----------------------------------------------
    "fliph": "flip_horizontally.svg",
    "flipv": "flip_vertically.svg",
    "rotate90": "rotate_right.svg",
    "rotate270": "rotate_left.svg",
    "rotate": "rotate_right.svg",
    "translate": "rotate_right.svg",
    "resize": "resize.svg",
    "binning": "binning.svg",
    # Processing / Level adjustment --------------------------------------
    "normalize": "normalize.svg",
    "clip": "clip.svg",
    "offset_correction": "offset_correction.svg",
    # Processing / Noise addition ----------------------------------------
    "add_gaussian_noise": "noise_addition.svg",
    "add_poisson_noise": "noise_addition.svg",
    "add_uniform_noise": "noise_addition.svg",
    # Processing / Noise reduction ---------------------------------------
    "gaussian_filter": "noise_reduction.svg",
    "moving_average": "noise_reduction.svg",
    "moving_median": "noise_reduction.svg",
    "wiener": "noise_reduction.svg",
    # Processing / Fourier analysis --------------------------------------
    "zero_padding": "fourier.svg",
    "fft": "fourier.svg",
    "ifft": "fourier.svg",
    "magnitude_spectrum": "fourier.svg",
    "phase_spectrum": "fourier.svg",
    "psd": "fourier.svg",
    # Processing / Frequency filters -------------------------------------
    "lowpass": "lowpass.svg",
    "highpass": "highpass.svg",
    "bandpass": "bandpass.svg",
    "bandstop": "bandstop.svg",
    "butterworth": "highpass.svg",
    "gaussian_freq_filter": "highpass.svg",
    # Processing / Fitting -----------------------------------------------
    "linear_fit": "linear_fit.svg",
    "polynomial_fit": "polynomial_fit.svg",
    "gaussian_fit": "gaussian_fit.svg",
    "lorentzian_fit": "lorentzian_fit.svg",
    "voigt_fit": "voigt_fit.svg",
    "planckian_fit": "planckian_fit.svg",
    "twohalfgaussian_fit": "twohalfgaussian_fit.svg",
    "piecewiseexponential_fit": "piecewiseexponential_fit.svg",
    "exponential_fit": "exponential_fit.svg",
    "sinusoidal_fit": "sinusoidal_fit.svg",
    "cdf_fit": "cdf_fit.svg",
    "sigmoid_fit": "sigmoid_fit.svg",
    "evaluate_fit": "exponential_fit.svg",
    # Processing (other) -------------------------------------------------
    "derivative": "derivative.svg",
    "integral": "integral.svg",
    "apply_window": "windowing.svg",
    "detrending": "detrending.svg",
    "interpolate": "interpolation.svg",
    "resampling": "resampling1d.svg",
    "peak_detection": "peak_detect.svg",
    # Processing / Stability analysis ------------------------------------
    "allan_variance": "stability.svg",
    "allan_deviation": "stability.svg",
    "modified_allan_variance": "stability.svg",
    "hadamard_variance": "stability.svg",
    "total_variance": "stability.svg",
    "time_deviation": "stability.svg",
    "overlapping_allan_variance": "stability.svg",
    # Processing / Thresholding ------------------------------------------
    "threshold": "thresholding.svg",
    "threshold_isodata": "thresholding.svg",
    "threshold_li": "thresholding.svg",
    "threshold_mean": "thresholding.svg",
    "threshold_minimum": "thresholding.svg",
    "threshold_otsu": "thresholding.svg",
    "threshold_triangle": "thresholding.svg",
    "threshold_yen": "thresholding.svg",
    # Processing / Exposure ----------------------------------------------
    "adjust_gamma": "exposure.svg",
    "adjust_log": "exposure.svg",
    "adjust_sigmoid": "exposure.svg",
    "equalize_hist": "exposure.svg",
    "equalize_adapthist": "exposure.svg",
    "rescale_intensity": "exposure.svg",
    # Processing / Restoration -------------------------------------------
    "denoise_tv": "noise_reduction.svg",
    "denoise_bilateral": "noise_reduction.svg",
    "denoise_wavelet": "noise_reduction.svg",
    "denoise_tophat": "noise_reduction.svg",
    # Processing / Morphology --------------------------------------------
    "white_tophat": "morphology.svg",
    "black_tophat": "morphology.svg",
    "erosion": "morphology.svg",
    "dilation": "morphology.svg",
    "opening": "morphology.svg",
    "closing": "morphology.svg",
    # Processing / Edge detection ----------------------------------------
    "canny": "edge_detection.svg",
    "roberts": "edge_detection.svg",
    "sobel": "edge_detection.svg",
    "sobel_h": "edge_detection.svg",
    "sobel_v": "edge_detection.svg",
    "laplace": "edge_detection.svg",
    "prewitt": "edge_detection.svg",
    "prewitt_h": "edge_detection.svg",
    "prewitt_v": "edge_detection.svg",
    "scharr": "edge_detection.svg",
    "scharr_h": "edge_detection.svg",
    "scharr_v": "edge_detection.svg",
    "farid": "edge_detection.svg",
    "farid_h": "edge_detection.svg",
    "farid_v": "edge_detection.svg",
    # Analysis (cross-kind: image → signal) ------------------------------
    "line_profile": "profile.svg",
    "segment_profile": "profile_segment.svg",
    "average_profile": "profile_average.svg",
    "radial_profile": "profile_radial.svg",
    "horizontal_projection": "profile.svg",
    "vertical_projection": "profile.svg",
    # Analysis (signal/image) --------------------------------------------
    "histogram": "histogram.svg",
}


def _build_catalog_for_kind(
    kind: str, overrides: dict[str, FeatureOverride]
) -> dict[str, FeatureSpec]:
    """Generic catalog builder shared by signal and image.

    Iteration order follows ``overrides`` (the curated dict), so menu
    entries appear in the same order as in the desktop DataLab Qt app —
    ``overrides`` is hand-written to mirror the ``register_*`` call order
    in :file:`datalab/gui/processor/{signal,image}.py`.
    """
    discovered = _collect_functions_for_kind(kind)
    catalog: dict[str, FeatureSpec] = {}
    for fname, override in overrides.items():
        func = discovered.get(fname)
        if func is None:
            continue
        pattern = override.pattern or _infer_pattern(func, kind=kind)
        if pattern is None:
            print(f"[processor] skip {fname!r} ({kind}): cannot infer pattern")
            continue
        icon = override.icon or _FEATURE_ICON_DEFAULTS.get(fname)
        catalog[fname] = FeatureSpec(
            feature_id=fname,
            label=override.label,
            menu_path=override.menu_path,
            pattern=pattern,
            icon=icon,
            operand_label=override.operand_label,
            paramclass=_extract_paramclass(func),
            func=func,
            object_kind=kind,
            skip_xarray_compat=override.skip_xarray_compat,
            output_kind=override.output_kind or kind,
        )
    missing = [k for k in overrides if k not in catalog]
    if missing:
        print(f"[processor] {kind} override(s) without matching function: {missing}")
    return catalog


def build_signal_catalog() -> dict[str, FeatureSpec]:
    """Build the curated signal feature catalogue."""
    return _build_catalog_for_kind("signal", SIGNAL_OVERRIDES)


def build_image_catalog() -> dict[str, FeatureSpec]:
    """Build the curated image feature catalogue."""
    return _build_catalog_for_kind("image", IMAGE_OVERRIDES)


def merge_plugin_features(
    catalog: dict[str, FeatureSpec], kind: str
) -> dict[str, FeatureSpec]:
    """Return *catalog* augmented with plugin-supplied features for *kind*.

    Reads :data:`datalab.registries.EXTRA_FEATURES` (populated by the
    portable ``datalab.gui.processor`` shim when plugins call
    ``register_1_to_1`` etc.) and converts each :class:`ExtraFeature` to
    a :class:`FeatureSpec`. Existing curated entries take precedence —
    plugins cannot override built-ins. The returned dict is always a
    *new* dict to keep the input untouched.
    """
    try:
        # Lazy: ``datalab`` is the in-Pyodide shim, not always present.
        # pylint: disable-next=import-outside-toplevel
        from datalab.registries import EXTRA_FEATURES
    except Exception:  # pylint: disable=broad-exception-caught
        # ``datalab`` shim absent (or partially installed) — plugins are
        # simply unavailable; never let that abort the host application.
        return dict(catalog)
    merged = dict(catalog)
    for extra in EXTRA_FEATURES.get(kind, ()):
        # Namespace plugin features under "plugin:<name>" so they never
        # clash with curated ids — even when plugins re-register the same
        # function across reloads.
        fid = extra.feature_id
        if fid in merged or f"plugin:{fid}" in merged:
            fid = f"plugin:{extra.origin or 'unknown'}:{extra.feature_id}"
        else:
            fid = f"plugin:{extra.feature_id}"
        merged[fid] = FeatureSpec(
            feature_id=fid,
            label=extra.label,
            menu_path=extra.menu_path,
            pattern=extra.pattern,
            icon=extra.icon,
            operand_label=extra.operand_label,
            paramclass=extra.paramclass,
            func=extra.func,
            object_kind=kind,
            skip_xarray_compat=extra.skip_xarray_compat,
            output_kind=kind,
        )
    return merged


# ---------------------------------------------------------------------------
# Generic processor
# ---------------------------------------------------------------------------


def _x_arrays_match(a: SignalObj, b: SignalObj) -> bool:
    """Return True iff *a* and *b* have identical X coordinates."""
    # Local import: numpy is already imported at module top, but the lazy
    # binding mirrors the desktop processor and keeps this helper usable
    # if the parent module is ever pruned for a slimmer Pyodide payload.
    import numpy as np  # pylint: disable=import-outside-toplevel

    if len(a.x) != len(b.x):
        return False
    return bool(np.allclose(a.x, b.x, rtol=1e-12))


def _interpolate_to(target: SignalObj, other: SignalObj) -> SignalObj:
    """Return *other* interpolated onto *target*'s X grid (if needed).

    Uses Sigima's linear interpolation.  Returns *other* unchanged when
    the X arrays already match.
    """
    if _x_arrays_match(target, other):
        return other
    # Lazy: ``sigima.tools.signal.interpolation`` pulls SciPy, which is
    # only worth loading when the X grids actually differ.
    # pylint: disable=import-outside-toplevel
    from sigima.enums import Interpolation1DMethod
    from sigima.tools.signal.interpolation import interpolate

    new_y = interpolate(
        other.x, other.y, target.x, Interpolation1DMethod.LINEAR, fill_value=None
    )
    dst = other.copy(title=f"{other.title} (interpolated)", all_metadata=True)
    dst.set_xydata(target.x, new_y)
    return dst


def _align_signals(signals: list[SignalObj]) -> list[SignalObj]:
    """Return a list where every signal shares the smallest X grid.

    Mirrors DataLab desktop behaviour: pick the smallest grid as target,
    interpolate the others linearly onto it.
    """
    if len(signals) <= 1:
        return signals
    sizes = [len(s.x) for s in signals]
    target_idx = sizes.index(min(sizes))
    target = signals[target_idx]
    return [
        s if i == target_idx else _interpolate_to(target, s)
        for i, s in enumerate(signals)
    ]


@dataclass
class ApplyContext:
    """Inputs needed to execute a feature.

    Attributes:
        feature: The resolved feature spec.
        sources: The source objects (list, even for 1_to_1 / 2_to_1).
        operand: Optional operand object (2_to_1 only).
        params: Optional dict of user-edited parameter values.
    """

    # Pure data container.
    # pylint: disable=too-few-public-methods

    feature: FeatureSpec
    sources: list[Any]
    operand: Any | None = None
    params: dict[str, Any] | None = None


@dataclass
class ApplyResult:
    """Result of a feature application.

    Each entry is ``(source_oid_or_None, result_object)``.  The
    ``source_oid`` is used by the caller to decide which group hosts the
    result (for ``n_to_1`` it is ``None`` — the caller picks the first
    source's group).
    """

    # Pure data container (a frozen-style dataclass with one field).
    # pylint: disable=too-few-public-methods

    items: list[tuple[str | None, Any]] = field(default_factory=list)


class BaseProcessor:
    """Generic dispatcher mirroring ``datalab.gui.processor.base``."""

    # Single-entry-point dispatcher; the rest of the surface is private
    # by design (each ``_compute_*`` is selected by ``apply``).
    # pylint: disable=too-few-public-methods

    def __init__(self, object_kind: str = "signal") -> None:
        self.object_kind = object_kind

    # -- Entry point --------------------------------------------------------

    def apply(self, ctx: ApplyContext, source_ids: list[str]) -> ApplyResult:
        """Apply the feature described by *ctx* to *source_ids* and return the result."""
        spec = ctx.feature
        instance = self._build_param_instance(spec, ctx.params)
        if spec.pattern == "1_to_1":
            return self._compute_1_to_1(spec, ctx.sources, source_ids, instance)
        if spec.pattern == "2_to_1":
            if ctx.operand is None:
                raise ValueError(f"Feature {spec.feature_id!r} requires an operand")
            return self._compute_2_to_1(
                spec, ctx.sources, source_ids, ctx.operand, instance
            )
        if spec.pattern == "n_to_1":
            return self._compute_n_to_1(spec, ctx.sources, instance)
        raise ValueError(f"Unsupported pattern: {spec.pattern!r}")

    # -- Pattern implementations -------------------------------------------

    def _compute_1_to_1(
        self,
        spec: FeatureSpec,
        sources: list[Any],
        source_ids: list[str],
        instance: gds.DataSet | None,
    ) -> ApplyResult:
        result = ApplyResult()
        for src, oid in zip(sources, source_ids):
            args: tuple[Any, ...] = (src,) if instance is None else (src, instance)
            result.items.append((oid, spec.func(*args)))
        return result

    def _compute_2_to_1(
        self,
        spec: FeatureSpec,
        sources: list[Any],
        source_ids: list[str],
        operand: Any,
        instance: gds.DataSet | None,
    ) -> ApplyResult:
        result = ApplyResult()
        for src, oid in zip(sources, source_ids):
            op = operand
            if spec.object_kind == "signal" and not spec.skip_xarray_compat:
                op = _interpolate_to(src, operand)
            args: tuple[Any, ...] = (
                (src, op) if instance is None else (src, op, instance)
            )
            result.items.append((oid, spec.func(*args)))
        return result

    def _compute_n_to_1(
        self,
        spec: FeatureSpec,
        sources: list[Any],
        instance: gds.DataSet | None,
    ) -> ApplyResult:
        srcs = sources
        if (
            spec.object_kind == "signal"
            and not spec.skip_xarray_compat
            and len(sources) > 1
        ):
            srcs = _align_signals(sources)
        args: tuple[Any, ...] = (srcs,) if instance is None else (srcs, instance)
        return ApplyResult(items=[(None, spec.func(*args))])

    # -- Helpers ------------------------------------------------------------

    @staticmethod
    def _build_param_instance(
        spec: FeatureSpec, params: dict[str, Any] | None
    ) -> gds.DataSet | None:
        if spec.paramclass is None:
            return None
        instance = spec.paramclass()
        if params:
            update_dataset(instance, params)
        return instance


# ---------------------------------------------------------------------------
# Catalogue serialisation
# ---------------------------------------------------------------------------


def serialize_catalog(catalog: dict[str, FeatureSpec]) -> list[dict[str, Any]]:
    """Return a JSON-friendly representation of *catalog*."""
    return [
        {
            "id": spec.feature_id,
            "label": spec.label,
            "menu_path": spec.menu_path,
            "pattern": spec.pattern,
            "icon": spec.icon,
            "has_params": spec.paramclass is not None,
            "operand_label": spec.operand_label,
            "object_kind": spec.object_kind,
            "output_kind": spec.output_kind,
        }
        for spec in catalog.values()
    ]


def get_schema(
    catalog: dict[str, FeatureSpec], feature_id: str
) -> dict[str, Any] | None:
    """Return the JSON schema for the parameters of *feature_id* (or ``None``)."""
    spec = catalog[feature_id]
    if spec.paramclass is None:
        return None
    return dataset_to_schema_with_values(spec.paramclass())


def resolve_choices(
    catalog: dict[str, FeatureSpec],
    feature_id: str,
    item_name: str,
    values: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Resolve dynamic choices for *item_name* of *feature_id* given *values*."""
    spec = catalog[feature_id]
    if spec.paramclass is None:
        raise ValueError(f"Feature {feature_id!r} has no parameters.")
    instance = spec.paramclass()
    if values:
        update_dataset(instance, values)
    return resolve_dynamic_choices(instance, item_name)


def resolve_callbacks(
    catalog: dict[str, FeatureSpec],
    feature_id: str,
    item_name: str,
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run *item_name*'s display callback for *feature_id* given *values*.

    Returns the post-callback values for every item so the frontend can
    refresh read-only computed fields (e.g. ``ArithmeticParam.operation``).
    """
    spec = catalog[feature_id]
    if spec.paramclass is None:
        raise ValueError(f"Feature {feature_id!r} has no parameters.")
    instance = spec.paramclass()
    if values:
        update_dataset(instance, values)
    return resolve_dataset_callbacks(instance, item_name)


__all__ = [
    "ApplyContext",
    "ApplyResult",
    "BaseProcessor",
    "FeatureOverride",
    "FeatureSpec",
    "IMAGE_OVERRIDES",
    "Pattern",
    "SIGNAL_OVERRIDES",
    "build_image_catalog",
    "build_signal_catalog",
    "get_schema",
    "merge_plugin_features",
    "resolve_callbacks",
    "resolve_choices",
    "serialize_catalog",
]
