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
&pluginVersion=0.1.0
&recipe=org.datalab.camera-characterization:relative-dn-characterization
&recipeVersion=1.1.0
&example=quickstart
```

The Pulse demo uses:

```text
?plugin=org.datalab.pulse-characterization
&pluginVersion=0.1.0
&recipe=org.datalab.pulse-characterization:single-channel-campaign
&recipeVersion=1.1.0
&example=demo
```

These blocks are wrapped for readability. Remove the line breaks when building
a URL, or construct the query with `URLSearchParams` so identifiers are encoded
correctly.

## Validation and loading

Once Pyodide is ready, DataLab-Web resolves the plugin only from its static
application registry and loads that plugin's compatibility manifest from the
bundled wheel. Plugin ID, plugin version, recipe ID, recipe version, and example
ID must all match exactly. The manifest must also report Web status `verified`.

Validation finishes before the workspace is changed. An unknown plugin,
incomplete request, version mismatch, unsupported example, or unverified
manifest produces a visible error. DataLab-Web never downloads or installs a
Python package in response to a deep link.

After validation:

- Camera replaces the workspace with its packaged HDF5 quickstart, opens the
  Images panel, and marks the loaded workspace clean.
- Pulse replaces the workspace with its deterministic 500-shot campaign, opens
  the Signals panel, and marks the generated workspace as unsaved.

The generic same-origin `preload` workspace parameter remains available for
ordinary HDF5 demos. When Applications parameters are present, their validated
workflow takes precedence and `preload` is ignored.
