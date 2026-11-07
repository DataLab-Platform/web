# Releasing DataLab-Web

> **Golden rule: never create a GitHub release by hand.** Push the tag, wait for the draft release prepared by the CI, then publish that draft.

A release takes two steps, both run by [`.github/workflows/release.yml`](.github/workflows/release.yml), which relies on the [release actions](https://github.com/DataLab-Platform/release-actions) shared by the DataLab Platform projects:

1. **Prepare**: pushing a release tag checks the tag, runs the release guard, the Python and end-to-end tests, lint, unit tests and the release build, packs the app and SDK tarballs, attests their build provenance and creates a **draft** GitHub release with these files and their `SHA256SUMS`. Nothing is published at this stage.
2. **Publish**: when a maintainer publishes the draft release, its tarballs are checked (checksums and attestations), then the static bundle of the checked app tarball is deployed to GitHub Pages. A release created by hand has none of these files, so nothing is deployed.

The qualification of the Python dependencies, the release contexts and the distributed tarballs are described in [doc/releasing.md](doc/releasing.md).

## Releasing a final version

1. Qualify the published dependencies (see [doc/releasing.md](doc/releasing.md)), then merge `develop` into `main`.
2. On `main`, run the release helper: it bumps both `package.json` files, promotes the `[Unreleased]` section of `CHANGELOG.md` (it becomes the description of the GitHub release, and the release is refused if it is missing), commits and tags `vX.Y.Z`:

   ```console
   git switch main
   git pull
   node scripts/release.mjs patch   # or minor, major
   git push origin main vX.Y.Z
   ```

   If `develop` already carries the version being released (both `package.json` files at `X.Y.Z`), pass that version instead of a keyword, e.g. `node scripts/release.mjs 0.11.0`: a keyword would bump it again.

3. Follow the **Prepare vX.Y.Z** run in the [Actions](https://github.com/DataLab-Platform/web/actions/workflows/release.yml) tab. When it succeeds, its summary links to the draft release.
4. Review the draft release (title, description, files: app tarball, SDK tarball and `SHA256SUMS`), then click **Publish release**.
5. Publishing starts the **Publish vX.Y.Z** run, which deploys the site.

## Release candidates

A tag `vX.Y.Z-rcN` (for example `v0.11.0-rc1`) follows the same two steps, with these differences: both `package.json` files must be at version `X.Y.Z-rcN` (for example `0.11.0-rc1`), the tag may be on any branch, the `CHANGELOG.md` section is optional, the draft release is marked as a pre-release, and publishing it does not deploy the site. Release candidates are the way to rehearse the procedure, or to check a change of the release workflow.

A manual run of the workflow (**Run workflow** in the Actions tab) is a dry run: same checks, tests and tarballs, without draft release nor deployment.

## When something goes wrong

| Symptom                                                                       | What to do                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The **Prepare** run fails (tag, guard, versions, tests or build)              | Nothing was published. Delete the tag (`git push --delete origin vX.Y.Z`, then `git tag -d vX.Y.Z`), fix the problem, then tag again. A draft release left by a failed attempt is replaced automatically. A failed job may also be re-run if the failure was transient. |
| A problem is found while reviewing the draft release                          | Delete the draft release and the tag, fix the problem, then tag again. Nothing was published.                                                                                                                                                                           |
| The **Prepare** run fails with "Release already published"                    | A release was created by hand for this tag. Delete it, then re-run the failed jobs of the **Prepare** run. If immutable releases are enabled on the repository, the tag cannot be reused: release version X.Y.Z+1 instead.                                              |
| The **Publish** run fails with "Release not prepared by the release workflow" | The published release was created by hand. Nothing was deployed: delete the release, then re-run the **Prepare** run of the tag (or, with immutable releases, release version X.Y.Z+1).                                                                                 |
| The deployment fails                                                          | Fix the cause, then click **Re-run failed jobs** on the **Publish** run: the tarballs are checked again before the deployment.                                                                                                                                          |

## Why this procedure

- The deployment of the site comes last, after a maintainer has reviewed the draft release.
- The site is exactly the static bundle of the released app tarball, built and attested by the release workflow.
- The files are attached before the release is published, as required by immutable releases.
- The same procedure applies to the other DataLab Platform projects (see the [release actions](https://github.com/DataLab-Platform/release-actions)).
