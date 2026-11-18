"""Browser-portable subset of :mod:`datalab` for DataLab-Web plugins.

This package mirrors the import surface of the desktop ``datalab``
package, minus everything that depends on Qt. Plugins authored against
DataLab Qt that don't import ``qtpy`` themselves can be loaded into
DataLab-Web without modification.

See :mod:`datalab.plugins` for the plugin-author API.
"""

from __future__ import annotations

# Level of the DataLab Desktop plugin API provided to plugins, reported as the
# version of ``datalab-platform`` when checking plugin requirements. Only the
# major and minor numbers are meaningful: change them when DataLab-Web follows a
# new minor version of DataLab Desktop, keeping the micro number at 0. Desktop
# micro versions only fix bugs, so plugins must not require one.
__version__ = "1.4.0"

__all__ = ["__version__"]
