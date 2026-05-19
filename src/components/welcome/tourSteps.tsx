/**
 * Default tour steps for DataLab-Web — built by
 * :func:`buildDefaultTourSteps` so they can capture runtime callbacks
 * (panel switcher, menu opener, demo seeding helpers).
 *
 * Targets are stable ``data-tour="…"`` (and ``data-menu-top="…"``)
 * anchors placed on existing UI elements.  Steps whose target is not
 * present at runtime gracefully degrade to a centered modal — see
 * :mod:`GuidedTour` for the fallback behaviour.
 *
 * The narrative mirrors the desktop tour
 * (``DataLab/datalab/gui/tour.py``): welcome → main window overview →
 * Signal panel (with each menu popped up) → Image panel → extensions
 * (Macros, Notebooks, Plugins, AI assistant) → Help → conclusion.
 */

import type { TourStep } from "./GuidedTour";

/** Runtime callbacks needed by the default tour steps. */
export interface TourContext {
  /** Switch between the Signal and Image panels. */
  setTreeKind: (kind: "signal" | "image") => void;
  /** Switch between the Plot / Macros / Notebooks central views. */
  setCentralView: (view: "plot" | "macro" | "notebook") => void;
  /** Open one of the top-level menubar dropdowns by its label. */
  openTopMenu: (label: string) => void;
  /** Close any currently open top-level menubar dropdown. */
  closeTopMenu: () => void;
  /** Seed a demo signal so the Signal-panel steps are not empty.
   *  Safe to call multiple times — implementations should be idempotent
   *  (or rely on :meth:`cleanupSeeded` between tour runs). */
  seedDemoSignal: () => Promise<void> | void;
  /** Seed a demo image so the Image-panel steps are not empty. */
  seedDemoImage: () => Promise<void> | void;
}

export function buildDefaultTourSteps(ctx: TourContext): TourStep[] {
  // Convenience wrappers — small enough to inline but they keep the
  // narrative declarations below readable.
  const popupMenu = (label: string): Partial<TourStep> => ({
    // Highlight only the open dropdown panel — not the menubar label.
    // The cover then naturally dims the menubar (the menu top remains
    // visually adjacent to the dropdown anyway), and the user gets a
    // single clean highlight ring around the dropdown contents.
    targetSelector: ".menu-dropdown",
    placement: "bottom",
    onEnter: () => ctx.openTopMenu(label),
    onLeave: () => ctx.closeTopMenu(),
    waitForTargetMs: 500,
  });

  return [
    {
      title: "Welcome aboard",
      body: (
        <>
          <p>
            DataLab-Web runs the Sigima scientific engine entirely in your
            browser. No data is uploaded — everything stays client-side.
          </p>
          <p>
            This tour walks through the main areas of the workspace, opening
            menus and switching panels as it goes. Use <kbd>→</kbd>/<kbd>←</kbd>
            to navigate, <kbd>Esc</kbd> to leave.
          </p>
        </>
      ),
    },
    {
      targetSelector: '[data-tour="menubar"]',
      placement: "bottom",
      title: "Menu bar",
      body: (
        <p>
          All actions live here, organised like the desktop DataLab: File,
          Create, Edit, ROI, Operations, Processing, Analysis, View, Plugins and
          Help.
        </p>
      ),
    },
    {
      targetSelector: '[data-tour="tree-kind-switcher"]',
      placement: "right",
      title: "Signal vs Image panel",
      body: (
        <p>
          Switch between the <strong>Signal</strong> (1D curves) and{" "}
          <strong>Image</strong> (2D arrays) workspaces. Each keeps its own
          object tree, selection and ROI editor.
        </p>
      ),
    },

    // ---- Signal panel ----
    {
      targetSelector: '[data-tour="object-tree"]',
      placement: "right",
      title: "Signal panel — Object tree",
      body: (
        <p>
          Loaded and created signals appear here, grouped just like in DataLab
          desktop. We just dropped in a demo sine wave so the following steps
          have something to highlight.
        </p>
      ),
      onEnter: async () => {
        ctx.setTreeKind("signal");
        ctx.setCentralView("plot");
        await ctx.seedDemoSignal();
      },
      waitForTargetMs: 600,
    },
    {
      targetSelector: '[data-tour="plot-host"]',
      placement: "left",
      title: "Signal panel — Plot view",
      body: (
        <p>
          Selected signals are plotted here with Plotly.js. Use the curve
          context menu or the toolbar on the left of the plot to customise
          appearance — settings are saved in the signal metadata.
        </p>
      ),
    },
    {
      targetSelector: ".side-panel",
      placement: "left",
      title: "Signal panel — Properties & results",
      body: (
        <p>
          Object properties, ROI editor and analysis results live in the
          right-hand panel. Forms are auto-generated from Sigima's guidata
          parameter classes — no hand-written dialogs.
        </p>
      ),
    },
    {
      ...popupMenu("File"),
      title: "Signal — File menu",
      body: (
        <p>
          Import and export signals individually (CSV, NPY, …) or save and
          restore the whole workspace as an HDF5 file. The browser stores recent
          workspaces in IndexedDB.
        </p>
      ),
    },
    {
      ...popupMenu("Create"),
      title: "Signal — Create menu",
      body: (
        <p>
          Generate signals from models discovered in Sigima's catalog (Gaussian,
          sine, paracetamol reference, …).
        </p>
      ),
    },
    {
      ...popupMenu("Edit"),
      title: "Signal — Edit menu",
      body: (
        <p>
          Rename, duplicate, regroup or delete the selected signals.
          Multi-selection works everywhere in the tree.
        </p>
      ),
    },
    {
      ...popupMenu("Operations"),
      title: "Signal — Operations menu",
      body: (
        <p>
          Arithmetic, basic mathematical functions and data-type conversions.
          Binary operations interpolate the second operand when X arrays differ.
        </p>
      ),
    },
    {
      ...popupMenu("Processing"),
      title: "Signal — Processing menu",
      body: (
        <p>
          1 ↦ 1 transformations: filters, FFT, fitting, calibration, axis
          transformations… Every entry comes from Sigima's processor catalog
          with its auto-generated parameter dialog.
        </p>
      ),
    },
    {
      ...popupMenu("Analysis"),
      title: "Signal — Analysis menu",
      body: (
        <p>
          1 ↦ 0 computations: measurements, statistics, FWHM, peak detection…
          Results land in the right-hand panel and are overlaid on the plot.
        </p>
      ),
    },

    // ---- Image panel ----
    {
      targetSelector: '[data-tour="object-tree"]',
      placement: "right",
      title: "Image panel",
      body: (
        <p>
          Switching to the <strong>Image</strong> workspace. The tree, plot and
          side panel all rebind to 2D arrays — and we seeded a synthetic image
          so the next steps have content.
        </p>
      ),
      onEnter: async () => {
        ctx.setTreeKind("image");
        ctx.setCentralView("plot");
        await ctx.seedDemoImage();
      },
      waitForTargetMs: 600,
    },
    {
      targetSelector: '[data-tour="plot-host"]',
      placement: "left",
      title: "Image panel — Plot view",
      body: (
        <p>
          Images are displayed with Plotly heatmaps. Colormap, contrast and ROI
          overlays are configurable from the toolbar and the context menu.
        </p>
      ),
    },
    {
      ...popupMenu("Create"),
      title: "Image — Create menu",
      body: (
        <p>
          Generate images from Sigima models (Gaussian, checkerboard, parametric
          noise, …). The same menu structure as for signals keeps muscle memory
          intact across panels.
        </p>
      ),
    },
    {
      ...popupMenu("Operations"),
      title: "Image — Operations menu",
      body: (
        <p>
          Arithmetic, pixel binning, intensity profiles, data-type conversions.{" "}
          <em>Edit</em>, <em>Processing</em> and <em>Analysis</em> menus mirror
          the Signal ones for images.
        </p>
      ),
    },

    // ---- Extensions ----
    {
      targetSelector: '[data-tour="central-view-switcher"]',
      placement: "bottom",
      title: "Macros panel",
      body: (
        <p>
          Macros are Python scripts that drive DataLab through its remote API.
          They run in a dedicated Pyodide worker so the UI stays responsive even
          during long computations.
        </p>
      ),
      onEnter: () => ctx.setCentralView("macro"),
    },
    {
      targetSelector: '[data-tour="central-view-switcher"]',
      placement: "bottom",
      title: "Notebooks panel",
      body: (
        <p>
          A lightweight Jupyter-like notebook for ad-hoc exploration. Each
          notebook owns its Pyodide worker and can call the same remote API as
          macros and plugins.
        </p>
      ),
      onEnter: () => ctx.setCentralView("notebook"),
    },
    {
      ...popupMenu("Plugins"),
      title: "Plugins",
      body: (
        <p>
          Third-party features live under the <strong>Plugins</strong> menu.
          They are Python modules loaded into Pyodide at startup — same plugin
          API as the desktop application.
        </p>
      ),
    },
    {
      ...popupMenu("Help"),
      title: "Help & user guide",
      body: (
        <p>
          The full user guide opens in a side drawer, and you can replay this
          tour any time from <strong>Help → Welcome</strong>.
        </p>
      ),
    },

    // ---- Conclusion ----
    {
      title: "You're ready",
      body: (
        <>
          <p>
            That's the end of the tour. The demo objects we created will be
            cleared as soon as you close this dialog.
          </p>
          <p>
            Start by creating a signal or image from the welcome page, or open
            an existing file from the <strong>File</strong> menu. Use the{" "}
            <strong>Restart</strong> button below to play the tour again.
          </p>
        </>
      ),
    },
  ];
}
