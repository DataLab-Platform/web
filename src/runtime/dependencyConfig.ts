import capsuleDependency from "../../datalab-capsule-dependency.json";
import sigimaDependency from "../../sigima-dependency.json";

/** Exact published Sigima requirement qualified for DataLab-Web releases. */
export const SIGIMA_PUBLISHED_REQUIREMENT =
  sigimaDependency.publishedRequirement;

/** Resolve a development override unless this is a release-qualified build. */
export function resolveSigimaInstallSpec(
  override?: string,
  releaseBuild = false,
): string {
  return releaseBuild
    ? SIGIMA_PUBLISHED_REQUIREMENT
    : override || SIGIMA_PUBLISHED_REQUIREMENT;
}

/** Sigima requirement installed by the main runtime and all workers. */
export const SIGIMA_INSTALL_SPEC =
  import.meta.env.MODE === "release"
    ? resolveSigimaInstallSpec(undefined, true)
    : resolveSigimaInstallSpec(import.meta.env.VITE_SIGIMA_INSTALL_SPEC);

/** Published DataLab-Capsule requirement, or ``null`` while unpublished. */
export const CAPSULE_PUBLISHED_REQUIREMENT: string | null =
  capsuleDependency.publishedRequirement;

/**
 * Resolve the optional DataLab-Capsule install spec (empty: not installed,
 * provenance unavailable). Release builds only use the published pin.
 */
export function resolveCapsuleInstallSpec(
  override?: string,
  releaseBuild = false,
  published: string | null = CAPSULE_PUBLISHED_REQUIREMENT,
): string {
  if (releaseBuild) return published ?? "";
  return override || published || "";
}

/** DataLab-Capsule requirement installed by the main/kernel runtime only. */
export const DATALAB_CAPSULE_INSTALL_SPEC =
  import.meta.env.MODE === "release"
    ? resolveCapsuleInstallSpec(undefined, true)
    : resolveCapsuleInstallSpec(
        import.meta.env.VITE_DATALAB_CAPSULE_INSTALL_SPEC,
      );
