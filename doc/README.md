# DataLab-Web documentation

Guides and reference material for DataLab-Web. Start with the [project README](../README.md) for the overview and quickstart.

## User guide

- [Welcome](userguide/welcome.md) — what DataLab-Web is and what you can do in it.
- [Computation engine](userguide/computation-engine.md) — how Sigima runs in the browser.
- [Differences from the desktop app](userguide/differences-from-desktop.md).

## Concepts & architecture

- [Architecture](architecture.md) — layer view, component view, worker protocols and end-to-end flows.
- [Persistence model](persistence.md) — the HDF5 workspace as the single source of truth.
- [Internationalisation](i18n.md) — translation framework and contributor workflow.

## Subsystems

- [Notebooks](notebooks.md) — multi-tab notebook panel, `.ipynb` import/export, macro conversion.
- [Plugins](plugins.md) — Qt-compatible `PluginBase` API, hot-reload and the bundled vitrine plugin.
- [Shim registry](shim-registry.md) — tracking temporary backport shims.

## Contributing & release

- [Testing strategy](testing-strategy.md) — the test pyramid, decision tree, and how to run each suite locally.
- [Releasing & distribution](releasing.md) — versioning, the release pipeline, and the app + SDK tarballs.
- [Troubleshooting](troubleshooting.md) — known browser quirks and workarounds.
- [Roadmap](roadmap.md) — short- and long-term plans.
- [CONTRIBUTING](../CONTRIBUTING.md) — project rules, including the Generative AI policy.

## Integration examples

- [Angular host app](examples/angular/README.md) — embedding DataLab-Web via the TypeScript SDK.
