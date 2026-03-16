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

import inspect
import importlib
import pkgutil
import typing
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

import guidata.dataset as gds
from guidata.dataset import (
    dataset_to_schema_with_values,
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


# Curated catalogue.  Keys must match the Sigima function name.  Functions
# not listed here are hidden from the menu (still accessible via
# ``apply_feature`` if their id is known — we don't enforce a guard).
SIGNAL_OVERRIDES: dict[str, FeatureOverride] = {
    # Operations / arithmetic ------------------------------------------------
    "addition": FeatureOverride("Sum", "Operations/Sum"),
    "average": FeatureOverride("Average", "Operations/Average"),
    "product": FeatureOverride("Product", "Operations/Product"),
    "difference": FeatureOverride(
        "Difference", "Operations/Difference", operand_label="Signal to subtract"
    ),
    "quadratic_difference": FeatureOverride(
        "Quadratic difference",
        "Operations/Quadratic difference",
        operand_label="Signal to subtract",
    ),
    "division": FeatureOverride(
        "Division", "Operations/Division", operand_label="Divisor"
    ),
    "addition_constant": FeatureOverride(
        "Add constant\u2026", "Operations/Constant/Add constant"
    ),
    "difference_constant": FeatureOverride(
        "Subtract constant\u2026", "Operations/Constant/Subtract constant"
    ),
    "product_constant": FeatureOverride(
        "Multiply by constant\u2026", "Operations/Constant/Multiply by constant"
    ),
    "inverse": FeatureOverride("Inverse", "Operations/Inverse"),
    "absolute": FeatureOverride("Absolute value", "Operations/Absolute value"),
    "real": FeatureOverride("Real part", "Operations/Real part"),
    "imag": FeatureOverride("Imaginary part", "Operations/Imaginary part"),
    "conjugate": FeatureOverride("Conjugate", "Operations/Conjugate"),
    # Processing -------------------------------------------------------------
    "normalize": FeatureOverride("Normalize\u2026", "Processing/Normalize"),
    "derivative": FeatureOverride("Derivative", "Processing/Derivative"),
    "integral": FeatureOverride("Integral", "Processing/Integral"),
    "moving_average": FeatureOverride(
        "Moving average\u2026", "Processing/Moving average"
    ),
    "moving_median": FeatureOverride(
        "Moving median\u2026", "Processing/Moving median"
    ),
    "wiener": FeatureOverride("Wiener filter", "Processing/Wiener filter"),
    "gaussian_filter": FeatureOverride(
        "Gaussian filter\u2026", "Processing/Gaussian filter"
    ),
    "calibration": FeatureOverride(
        "Linear calibration\u2026", "Processing/Axis transformation/Linear calibration"
    ),
    # Math -------------------------------------------------------------------
    "exp": FeatureOverride("Exponential", "Operations/Math/Exponential"),
    "log10": FeatureOverride("Log10", "Operations/Math/Log10"),
    "sqrt": FeatureOverride("Square root", "Operations/Math/Square root"),
    "power": FeatureOverride("Power\u2026", "Operations/Math/Power"),
    # Fourier ----------------------------------------------------------------
    "fft": FeatureOverride("FFT", "Processing/Fourier analysis/FFT"),
    "ifft": FeatureOverride("Inverse FFT", "Processing/Fourier analysis/Inverse FFT"),
    "magnitude_spectrum": FeatureOverride(
        "Magnitude spectrum", "Processing/Fourier analysis/Magnitude spectrum"
    ),
    "phase_spectrum": FeatureOverride(
        "Phase spectrum", "Processing/Fourier analysis/Phase spectrum"
    ),
    "psd": FeatureOverride("PSD", "Processing/Fourier analysis/Power spectral density"),
}


# Curated image catalogue.  Same conventions as ``SIGNAL_OVERRIDES``.
IMAGE_OVERRIDES: dict[str, FeatureOverride] = {
    # Operations / arithmetic ------------------------------------------------
    "addition": FeatureOverride("Sum", "Operations/Sum"),
    "average": FeatureOverride("Average", "Operations/Average"),
    "product": FeatureOverride("Product", "Operations/Product"),
    "difference": FeatureOverride(
        "Difference", "Operations/Difference", operand_label="Image to subtract"
    ),
    "quadratic_difference": FeatureOverride(
        "Quadratic difference",
        "Operations/Quadratic difference",
        operand_label="Image to subtract",
    ),
    "division": FeatureOverride(
        "Division", "Operations/Division", operand_label="Divisor"
    ),
    "addition_constant": FeatureOverride(
        "Add constant\u2026", "Operations/Constant/Add constant"
    ),
    "difference_constant": FeatureOverride(
        "Subtract constant\u2026", "Operations/Constant/Subtract constant"
    ),
    "product_constant": FeatureOverride(
        "Multiply by constant\u2026", "Operations/Constant/Multiply by constant"
    ),
    "division_constant": FeatureOverride(
        "Divide by constant\u2026", "Operations/Constant/Divide by constant"
    ),
    "inverse": FeatureOverride("Inverse", "Operations/Inverse"),
    "absolute": FeatureOverride("Absolute value", "Operations/Absolute value"),
    "real": FeatureOverride("Real part", "Operations/Real part"),
    "imag": FeatureOverride("Imaginary part", "Operations/Imaginary part"),
    "conjugate": FeatureOverride("Conjugate", "Operations/Conjugate"),
    "logp1": FeatureOverride("Log10(z+n)\u2026", "Operations/Math/Log10(z+n)"),
    "exp": FeatureOverride("Exponential", "Operations/Math/Exponential"),
    "log10": FeatureOverride("Log10", "Operations/Math/Log10"),
    # Processing -------------------------------------------------------------
    "normalize": FeatureOverride("Normalize\u2026", "Processing/Normalize"),
    "calibration": FeatureOverride(
        "Linear calibration\u2026", "Processing/Linear calibration"
    ),
    "clip": FeatureOverride("Clip\u2026", "Processing/Clip"),
    # Filtering --------------------------------------------------------------
    "gaussian_filter": FeatureOverride(
        "Gaussian filter\u2026", "Processing/Filtering/Gaussian filter"
    ),
    "moving_average": FeatureOverride(
        "Moving average\u2026", "Processing/Filtering/Moving average"
    ),
    "moving_median": FeatureOverride(
        "Moving median\u2026", "Processing/Filtering/Moving median"
    ),
    "wiener": FeatureOverride("Wiener filter", "Processing/Filtering/Wiener filter"),
    # Edges ------------------------------------------------------------------
    "canny": FeatureOverride("Canny\u2026", "Processing/Edges/Canny"),
    "roberts": FeatureOverride("Roberts", "Processing/Edges/Roberts"),
    "sobel": FeatureOverride("Sobel", "Processing/Edges/Sobel"),
    "laplace": FeatureOverride("Laplace", "Processing/Edges/Laplace"),
    "prewitt": FeatureOverride("Prewitt", "Processing/Edges/Prewitt"),
    "scharr": FeatureOverride("Scharr", "Processing/Edges/Scharr"),
    # Threshold --------------------------------------------------------------
    "threshold": FeatureOverride("Threshold\u2026", "Processing/Threshold/Threshold"),
    "threshold_isodata": FeatureOverride(
        "Isodata", "Processing/Threshold/Isodata"
    ),
    "threshold_li": FeatureOverride("Li", "Processing/Threshold/Li"),
    "threshold_mean": FeatureOverride("Mean", "Processing/Threshold/Mean"),
    "threshold_otsu": FeatureOverride("Otsu", "Processing/Threshold/Otsu"),
    "threshold_triangle": FeatureOverride(
        "Triangle", "Processing/Threshold/Triangle"
    ),
    "threshold_yen": FeatureOverride("Yen", "Processing/Threshold/Yen"),
    # Exposure ---------------------------------------------------------------
    "adjust_gamma": FeatureOverride(
        "Gamma correction\u2026", "Processing/Exposure/Gamma correction"
    ),
    "adjust_log": FeatureOverride(
        "Log correction\u2026", "Processing/Exposure/Log correction"
    ),
    "adjust_sigmoid": FeatureOverride(
        "Sigmoid correction\u2026", "Processing/Exposure/Sigmoid correction"
    ),
    "equalize_hist": FeatureOverride(
        "Histogram equalization", "Processing/Exposure/Histogram equalization"
    ),
    "equalize_adapthist": FeatureOverride(
        "Adaptive histogram equalization\u2026",
        "Processing/Exposure/Adaptive histogram equalization",
    ),
    "rescale_intensity": FeatureOverride(
        "Intensity rescaling\u2026",
        "Processing/Exposure/Intensity rescaling",
    ),
    # Geometry ---------------------------------------------------------------
    "flatfield": FeatureOverride(
        "Flat-field correction\u2026",
        "Processing/Flat-field correction",
        operand_label="Flat-field image",
    ),
    "rotate90": FeatureOverride(
        "Rotate 90\u00b0", "Processing/Geometry/Rotate 90\u00b0"
    ),
    "rotate270": FeatureOverride(
        "Rotate 270\u00b0", "Processing/Geometry/Rotate 270\u00b0"
    ),
    "fliph": FeatureOverride(
        "Horizontal flip", "Processing/Geometry/Horizontal flip"
    ),
    "flipv": FeatureOverride("Vertical flip", "Processing/Geometry/Vertical flip"),
    "rotate": FeatureOverride(
        "Rotate arbitrarily\u2026", "Processing/Geometry/Rotate"
    ),
    "resize": FeatureOverride("Resize\u2026", "Processing/Geometry/Resize"),
    "binning": FeatureOverride("Pixel binning\u2026", "Processing/Geometry/Binning"),
    # Morphology -------------------------------------------------------------
    "white_tophat": FeatureOverride(
        "White Top-Hat\u2026", "Processing/Morphology/White Top-Hat"
    ),
    "black_tophat": FeatureOverride(
        "Black Top-Hat\u2026", "Processing/Morphology/Black Top-Hat"
    ),
    "erosion": FeatureOverride("Erosion\u2026", "Processing/Morphology/Erosion"),
    "dilation": FeatureOverride("Dilation\u2026", "Processing/Morphology/Dilation"),
    "opening": FeatureOverride("Opening\u2026", "Processing/Morphology/Opening"),
    "closing": FeatureOverride("Closing\u2026", "Processing/Morphology/Closing"),
    # Fourier ----------------------------------------------------------------
    "fft": FeatureOverride("FFT", "Processing/Fourier analysis/FFT"),
    "ifft": FeatureOverride("Inverse FFT", "Processing/Fourier analysis/Inverse FFT"),
    "magnitude_spectrum": FeatureOverride(
        "Magnitude spectrum", "Processing/Fourier analysis/Magnitude spectrum"
    ),
    "phase_spectrum": FeatureOverride(
        "Phase spectrum", "Processing/Fourier analysis/Phase spectrum"
    ),
    "psd": FeatureOverride("PSD", "Processing/Fourier analysis/Power spectral density"),
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


def _build_catalog_for_kind(
    kind: str, overrides: dict[str, FeatureOverride]
) -> dict[str, FeatureSpec]:
    """Generic catalog builder shared by signal and image."""
    discovered = _collect_functions_for_kind(kind)
    catalog: dict[str, FeatureSpec] = {}
    for fname, func in discovered.items():
        override = overrides.get(fname)
        if override is None:
            continue
        pattern = override.pattern or _infer_pattern(func, kind=kind)
        if pattern is None:
            print(f"[processor] skip {fname!r} ({kind}): cannot infer pattern")
            continue
        catalog[fname] = FeatureSpec(
            feature_id=fname,
            label=override.label,
            menu_path=override.menu_path,
            pattern=pattern,
            icon=override.icon,
            operand_label=override.operand_label,
            paramclass=_extract_paramclass(func),
            func=func,
            object_kind=kind,
            skip_xarray_compat=override.skip_xarray_compat,
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


# ---------------------------------------------------------------------------
# Generic processor
# ---------------------------------------------------------------------------


def _x_arrays_match(a: SignalObj, b: SignalObj) -> bool:
    """Return True iff *a* and *b* have identical X coordinates."""
    import numpy as np

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
    return [s if i == target_idx else _interpolate_to(target, s) for i, s in enumerate(signals)]


@dataclass
class ApplyContext:
    """Inputs needed to execute a feature.

    Attributes:
        feature: The resolved feature spec.
        sources: The source objects (list, even for 1_to_1 / 2_to_1).
        operand: Optional operand object (2_to_1 only).
        params: Optional dict of user-edited parameter values.
    """

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

    items: list[tuple[str | None, Any]] = field(default_factory=list)


class BaseProcessor:
    """Generic dispatcher mirroring ``datalab.gui.processor.base``."""

    def __init__(self, object_kind: str = "signal") -> None:
        self.object_kind = object_kind

    # -- Entry point --------------------------------------------------------

    def apply(self, ctx: ApplyContext, source_ids: list[str]) -> ApplyResult:
        spec = ctx.feature
        instance = self._build_param_instance(spec, ctx.params)
        if spec.pattern == "1_to_1":
            return self._compute_1_to_1(spec, ctx.sources, source_ids, instance)
        if spec.pattern == "2_to_1":
            if ctx.operand is None:
                raise ValueError(
                    f"Feature {spec.feature_id!r} requires an operand"
                )
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
        }
        for spec in catalog.values()
    ]


def get_schema(catalog: dict[str, FeatureSpec], feature_id: str) -> dict[str, Any] | None:
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
    spec = catalog[feature_id]
    if spec.paramclass is None:
        raise ValueError(f"Feature {feature_id!r} has no parameters.")
    instance = spec.paramclass()
    if values:
        update_dataset(instance, values)
    return resolve_dynamic_choices(instance, item_name)


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
    "resolve_choices",
    "serialize_catalog",
]
