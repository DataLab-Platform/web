# Persistence model

DataLab-Web treats the **HDF5 workspace file as the single durable source of truth**. Everything else — IndexedDB caches, the recent notebooks/macros menus, even the in-memory Python object model — is ephemeral and reset on a hard reload of the Pyodide instance.

| Asset class                               | Survives F5 reload?              | How to make durable                                                              |
| ----------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Signals & images                          | **No** — wiped with Pyodide      | **File → Save HDF5 workspace…**                                                  |
| Groups, ROIs, metadata, plot annotations  | **No** — wiped with Pyodide      | **File → Save HDF5 workspace…**                                                  |
| Macro **content**                         | Reachable via the _Recent…_ menu | **File → Save HDF5 workspace…** for the full workspace, or download individually |
| Notebook **content**                      | Reachable via the _Recent…_ menu | **File → Save HDF5 workspace…**, or **Save notebook as…** for a `.ipynb`         |
| Notebook **outputs / execution counters** | **No** — outputs aren't cached   | Save HDF5 workspace (outputs are persisted there too)                            |

Macros and notebooks you edit are kept in a roll-over IndexedDB cache so you can re-open them later, but they are **not** silently restored into a fresh session: they only appear in each panel's **Recent…** menu. Pristine, auto-created sample documents are never cached.

How this surfaces in the UI:

- The window title shows `DataLab-Web — <filename or "Untitled">`, with a `•` marker as soon as the workspace contains unsaved changes, cleared on the next **Open / Save HDF5 workspace…**.
- A `beforeunload` confirmation prompt fires only when the workspace is dirty.
- A one-time informational banner appears at cold start if the IndexedDB cache holds edited macros or notebooks, pointing you at the **Recent…** menus where you can re-open them. **Dismiss** hides it for the session.
- Fresh sessions are labelled **Untitled**. The first **File → Save HDF5 workspace…** proposes a timestamped name (`workspace-YYYYMMDD-HHMMSS.h5`); subsequent saves reuse the last filename associated with the session.

The behaviour mirrors DataLab desktop: closing without saving loses unsaved work; opening an HDF5 workspace replaces the in-memory state.
