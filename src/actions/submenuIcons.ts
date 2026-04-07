/**
 * Sub-menu (folder) → SVG icon mapping.
 *
 * Mirrors the ``new_menu(_("..."), icon_name=...)`` calls in DataLab
 * desktop's ``actionhandler.py``.  The hierarchy is reconstructed
 * client-side from the flat ``menuPath`` strings of each action
 * (cf. :file:`./buildMenu.ts`), so the lookup table lives here rather than
 * in the Python catalogue.
 *
 * Keys are full menu paths (joined by "/"); values are bare SVG filenames
 * resolved through the corresponding bundle-time index.
 */

import { getFeatureIconUrl } from "../assets/featureIcons";
import { getRoiIconUrl } from "../assets/roiIcons";

interface SubmenuIconEntry {
  /** Bare SVG filename. */
  file: string;
  /** Resolver to apply to ``file``. */
  resolver: (name: string) => string | undefined;
}

const SUBMENU_ICONS: Record<string, SubmenuIconEntry> = {
  // Operations -----------------------------------------------------------
  "Operations/Constant": { file: "constant.svg", resolver: getFeatureIconUrl },
  // Processing -----------------------------------------------------------
  "Processing/Axis transformation": {
    file: "axis_transform.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Level adjustment": {
    file: "level_adjustment.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Noise addition": {
    file: "noise_addition.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Noise reduction": {
    file: "noise_reduction.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Fourier analysis": {
    file: "fourier.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Frequency filters": {
    file: "highpass.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Fitting": {
    file: "exponential_fit.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Fitting/Interactive fitting": {
    file: "interactive_fit.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Stability analysis": {
    file: "stability.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Geometry": {
    file: "rotate_right.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Thresholding": {
    file: "thresholding.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Exposure": { file: "exposure.svg", resolver: getFeatureIconUrl },
  "Processing/Restoration": {
    file: "noise_reduction.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Morphology": {
    file: "morphology.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Edge detection": {
    file: "edge_detection.svg",
    resolver: getFeatureIconUrl,
  },
  "Processing/Intensity profiles": {
    file: "profile.svg",
    resolver: getFeatureIconUrl,
  },
  // ROI ------------------------------------------------------------------
  "ROI/Remove": { file: "roi_delete", resolver: getRoiIconUrl },
};

export function resolveSubmenuIcon(path: string): string | undefined {
  const entry = SUBMENU_ICONS[path];
  if (!entry) return undefined;
  return entry.resolver(entry.file);
}
