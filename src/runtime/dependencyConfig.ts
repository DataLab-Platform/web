import guidataDependency from "../../guidata-dependency.json";
import sigimaDependency from "../../sigima-dependency.json";

/** Exact published Sigima requirement qualified for DataLab-Web releases. */
export const SIGIMA_PUBLISHED_REQUIREMENT =
  sigimaDependency.publishedRequirement;

/** Published guidata requirement qualified for DataLab-Web releases. */
export const GUIDATA_PUBLISHED_REQUIREMENT =
  guidataDependency.publishedRequirement;

/** Resolve a development override unless this is a release-qualified build. */
export function resolveInstallSpec(
  publishedRequirement: string,
  override?: string,
  releaseBuild = false,
): string {
  return releaseBuild ? publishedRequirement : override || publishedRequirement;
}

/** Resolve the Sigima requirement, honouring a non-release override. */
export function resolveSigimaInstallSpec(
  override?: string,
  releaseBuild = false,
): string {
  return resolveInstallSpec(
    SIGIMA_PUBLISHED_REQUIREMENT,
    override,
    releaseBuild,
  );
}

const RELEASE_BUILD = import.meta.env.MODE === "release";

/** Sigima requirement installed by the main runtime and all workers. */
export const SIGIMA_INSTALL_SPEC = resolveSigimaInstallSpec(
  import.meta.env.VITE_SIGIMA_INSTALL_SPEC,
  RELEASE_BUILD,
);

/** guidata requirement installed by the main runtime and all workers. */
export const GUIDATA_INSTALL_SPEC = resolveInstallSpec(
  GUIDATA_PUBLISHED_REQUIREMENT,
  import.meta.env.VITE_GUIDATA_INSTALL_SPEC,
  RELEASE_BUILD,
);
