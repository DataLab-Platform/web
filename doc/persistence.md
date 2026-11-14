# Persistence model

DataLab-Web treats the **HDF5 workspace file as the single durable source of truth**. Everything else — IndexedDB caches, the recent notebooks/macros menus, even the in-memory Python object model — is ephemeral and reset on a hard reload of the Pyodide instance.

| Asset class                               | Survives F5 reload?                                        | How to make durable                                                            |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Signals & images                          | **No** — wiped with Pyodide                                | **File → Save to HDF5 file…**                                                  |
| Groups, ROIs, metadata, plot annotations  | **No** — wiped with Pyodide                                | **File → Save to HDF5 file…**                                                  |
| Macro **content**                         | Reachable via the _Recent…_ menu                           | **File → Save to HDF5 file…** for the full workspace, or download individually |
| Notebook **content**                      | Reachable via the _Recent…_ menu                           | **File → Save to HDF5 file…**, or the notebook's **Export…** for a `.ipynb`    |
| Notebook **outputs / execution counters** | Reachable via the _Recent…_ menu, cached with the notebook | Save to HDF5 file (outputs are persisted there too)                            |

Macros and notebooks you edit are kept in a roll-over IndexedDB cache so you can re-open them later, but they are **not** silently restored into a fresh session: they only appear in each panel's **Recent…** menu. Pristine, auto-created sample documents are never cached.

How this surfaces in the UI:

- The window title shows `DataLab-Web — <filename or "Untitled">`, with a `•` marker as soon as the workspace contains unsaved changes, cleared on the next **Open HDF5 files… / Save to HDF5 file…**.
- A `beforeunload` confirmation prompt fires only when the workspace is dirty.
- A one-time informational banner appears at cold start if the IndexedDB cache holds edited macros or notebooks, pointing you at the **Recent…** menus where you can re-open them. **Dismiss** hides it for the session.
- Fresh sessions are labelled **Untitled**. The first **File → Save to HDF5 file…** proposes `Untitled.h5`; subsequent saves reuse the last filename associated with the session.
- **File → New workspace** starts a clean workspace without reloading the page or restarting the main Python runtime. If the current workspace has unsaved changes or Python code is running, confirmation is required before those changes are discarded and the running code is stopped. The new workspace has empty signal and image panels, the default macro and a blank notebook. Existing HDF5 files, preferences and the **Recent…** caches are not deleted.

The behaviour mirrors DataLab desktop: closing without saving loses unsaved work; opening an HDF5 workspace replaces the in-memory state.
