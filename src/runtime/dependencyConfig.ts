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
