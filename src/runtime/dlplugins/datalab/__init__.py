"""Browser-portable subset of :mod:`datalab` for DataLab-Web plugins.

This package mirrors the import surface of the desktop ``datalab``
package, minus everything that depends on Qt. Plugins authored against
DataLab Qt that don't import ``qtpy`` themselves can be loaded into
DataLab-Web without modification.

See :mod:`datalab.plugins` for the plugin-author API.
"""

from __future__ import annotations

__all__: list[str] = []
