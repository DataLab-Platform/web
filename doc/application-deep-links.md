# Applications deep links

Documentation and product pages may open an application example already
bundled in DataLab-Web. The query string must declare the complete workflow
contract:

| Parameter       | Meaning                                     |
| --------------- | ------------------------------------------- |
| `plugin`        | Namespaced plugin identifier                |
| `pluginVersion` | Exact bundled plugin version                |
| `recipe`        | Namespaced recipe identifier                |
| `recipeVersion` | Exact bundled recipe version                |
| `example`       | Example identifier supported by the Web app |

All five parameters are required. For example, the Camera quickstart link is:

```text
?plugin=org.datalab.camera-characterization
&pluginVersion=0.2.0
&recipe=org.datalab.camera-characterization:relative-dn-characterization
&recipeVersion=1.1.0
&example=quickstart
```

The Pulse demo uses:

```text
?plugin=org.datalab.pulse-characterization
&pluginVersion=0.2.0
&recipe=org.datalab.pulse-characterization:single-channel-campaign
&recipeVersion=1.1.0
&example=demo
```

The other bundled methods use recipe version `1.0.0` with these recipe and example pairs:

| Plugin | Recipe (local ID)       | Example              |
| ------ | ----------------------- | -------------------- |
| Camera | `photon-transfer`       | `photon-transfer`    |
| Camera | `dark-current`          | `dark-ramp`          |
| Pulse  | `shot-stability`        | `stability-demo`     |
| Pulse  | `step-response`         | `step-response-demo` |
| Pulse  | `two-channel-delay`     | `two-channel-demo`   |
| Pulse  | `pulse-height-spectrum` | `spectrum-demo`      |

These blocks are wrapped for readability. Remove the line breaks when building
a URL, or construct the query with `URLSearchParams` so identifiers are encoded
correctly.

## Validation and loading

Once Pyodide is ready, DataLab-Web resolves the request from the live managed
plugin registry. The matching record must be loaded and enabled, have source
`bundled-wheel`, and have trust status `verified`. Plugin ID, plugin version,
recipe ID, recipe version, and example ID must all match exactly, and the
example must list the recipe among the methods it is designed for.

Validation finishes before the workspace is changed. An unknown plugin,
incomplete request, version mismatch, unsupported example, disabled plugin, or
unverified artifact produces a visible error. A user-installed wheel with the
same plugin ID is never an implicit target. DataLab-Web never downloads,
installs, or enables a Python package in response to a deep link.

After validation:

- Camera replaces the workspace with its packaged HDF5 quickstart, opens the
  Images panel, and marks the loaded workspace clean.
- Pulse replaces the workspace with its deterministic 500-shot campaign, opens
  the Signals panel, and marks the generated workspace as unsaved.
- The Applications dialog selects the requested plugin and highlights the method. Its readiness status covers every object selected by the example, even when only part of them is visibly selected, and the example's parameter values for this method prefill its parameter dialog. The method never runs until the user clicks _Run on selection…_.

The generic same-origin `preload` workspace parameter remains available for
ordinary HDF5 demos. When Applications parameters are present, their validated
workflow takes precedence and `preload` is ignored.
