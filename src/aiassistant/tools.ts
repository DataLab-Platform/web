/**
 * Built-in tool registry for the AI Assistant.
 *
 * Each tool exposes a JSON Schema (OpenAI function-calling format) and
 * a handler that delegates to the existing :class:`DataLabRuntime`
 * facade. No new Python helpers are required for v1.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/tools/builtin.py``.
 */

import type {
  RuntimeApi,
  ImageCreationParams,
  ObjectStats,
  SignalCreationParams,
} from "../runtime/runtime";
import {
  capturePlotPng,
  getMostRecentPanel,
  type PanelKind,
} from "./plotCapture";
import { isToolResult, type Tool, type ToolResult } from "./types";

/** Compact statistics for a 1D signal — sent to the LLM instead of the
 *  full ``y`` array, which would blow the context window for any
 *  realistic signal. The numeric stats come from Sigima (via
 *  :meth:`DataLabRuntime.getObjectStats`); only the head/tail sample
 *  previews are sliced here. */
function summariseSignal(
  meta: {
    id: string;
    title: string;
    xunit: string;
    yunit: string;
    xlabel: string;
    ylabel: string;
  },
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  stats: Extract<ObjectStats, { kind: "signal" }>,
): Record<string, unknown> {
  const n = y.length;
  if (n === 0) {
    return { ...meta, n: 0 };
  }
  const previewN = Math.min(8, n);
  const head = (a: ArrayLike<number>, count: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < Math.min(count, a.length); i += 1) out.push(a[i]);
    return out;
  };
  const tail = (a: ArrayLike<number>, count: number): number[] => {
    const out: number[] = [];
    for (let i = Math.max(0, a.length - count); i < a.length; i += 1)
      out.push(a[i]);
    return out;
  };
  return {
    ...meta,
    n,
    x_min: stats.x_min,
    x_max: stats.x_max,
    y_min: stats.y_min,
    y_max: stats.y_max,
    y_mean: stats.y_mean,
    y_std: stats.y_std,
    y_median: stats.y_median,
    first_x: head(x, previewN),
    first_y: head(y, previewN),
    last_x: tail(x, previewN),
    last_y: tail(y, previewN),
  };
}

const LIST_PANELS_TOOL: Tool = {
  name: "list_panels",
  description:
    "List the object panels available in the workspace " +
    "(currently 'signal' and 'image').",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readonly: true,
  handler: async () => ["signal", "image"],
};

const LIST_SIGNALS_TOOL: Tool = {
  name: "list_signals",
  description:
    "List every signal in the workspace with its id, title and units.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readonly: true,
  handler: async (runtime) => runtime.listSignals(),
};

const LIST_IMAGES_TOOL: Tool = {
  name: "list_images",
  description:
    "List every image in the workspace by walking the image panel tree.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readonly: true,
  handler: async (runtime) => {
    const tree = await runtime.getPanelTree("image");
    return tree.groups.flatMap((g) =>
      g.objects.map((o) => ({
        id: o.id,
        title: o.title,
        group: g.name,
      })),
    );
  },
};

const GET_SIGNAL_SUMMARY_TOOL: Tool = {
  name: "get_signal_summary",
  description:
    "Return compact statistics (n, x range, y min/max/mean/std) plus " +
    "the first and last 8 samples of a signal. Use this instead of " +
    "trying to read the full sample array — long arrays would blow the " +
    "LLM context window.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Signal id." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  readonly: true,
  handler: async (runtime, args) => {
    const id = String(args.id);
    const data = await runtime.getSignalData(id);
    const stats = await runtime.getObjectStats(id);
    if (stats.kind !== "signal") {
      throw new Error(`Object ${id} is not a signal.`);
    }
    return summariseSignal(
      {
        id: data.id,
        title: data.title,
        xunit: data.xunit,
        yunit: data.yunit,
        xlabel: data.xlabel,
        ylabel: data.ylabel,
      },
      data.x,
      data.y,
      stats,
    );
  },
};

const GET_IMAGE_META_TOOL: Tool = {
  name: "get_image_meta",
  description:
    "Return metadata (id, title, shape, x0/y0/dx/dy) for an image, " +
    "without the pixel array (which would be too large to send to the LLM).",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Image id." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  readonly: true,
  handler: async (runtime, args) => {
    const id = String(args.id);
    const data = await runtime.getImageData(id);
    return {
      id: data.id,
      title: data.title,
      width: data.width,
      height: data.height,
      x0: data.x0,
      y0: data.y0,
      dx: data.dx,
      dy: data.dy,
      xunit: data.xunit,
      yunit: data.yunit,
    };
  },
};

const LIST_PROCESSINGS_TOOL: Tool = {
  name: "list_processings",
  description:
    "List every processing operation registered in DataLab-Web with " +
    "its id, label, and whether it accepts parameters. Always call " +
    "this before 'apply_processing' to discover valid operation ids.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readonly: true,
  handler: async (runtime) => runtime.listProcessings(),
};

const CREATE_SIGNAL_TOOL: Tool = {
  name: "create_synthetic_signal",
  description:
    "Create a new synthetic 1D signal from scratch and add it to the " +
    "workspace. Use this for prompts like 'create a gaussian', " +
    "'add a sine wave', 'generate noise', etc. This is the only way to " +
    "produce a signal when none exists yet — do NOT use 'apply_processing' " +
    "to create one (apply_processing requires a pre-existing source).",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["sine", "cosine", "gauss", "noise"],
        description:
          "Signal kind. 'gauss' produces a gaussian curve " +
          "(parameters: a, mu, sigma). 'sine'/'cosine' produce sinusoids " +
          "(parameters: a, freq, phase). 'noise' produces Gaussian white " +
          "noise (parameter: a).",
      },
      title: {
        type: "string",
        description: "Display title for the new signal.",
      },
      size: {
        type: "integer",
        description: "Number of samples (default 500).",
      },
      xmin: {
        type: "number",
        description: "X-axis lower bound (default -10).",
      },
      xmax: {
        type: "number",
        description: "X-axis upper bound (default 10).",
      },
      a: { type: "number", description: "Amplitude (default 1)." },
      freq: {
        type: "number",
        description: "Frequency in Hz, used by sine/cosine (default 1).",
      },
      phase: {
        type: "number",
        description: "Phase in radians, used by sine/cosine (default 0).",
      },
      mu: {
        type: "number",
        description: "Centre of the gaussian (default 0).",
      },
      sigma: {
        type: "number",
        description:
          "Standard deviation of the gaussian (default 1, must be > 0).",
      },
    },
    required: ["kind", "title"],
    additionalProperties: false,
  },
  readonly: false,
  handler: async (runtime, args) => {
    const params: SignalCreationParams = {
      kind: args.kind as SignalCreationParams["kind"],
      title: String(args.title),
      size: typeof args.size === "number" ? args.size : 500,
      xmin: typeof args.xmin === "number" ? args.xmin : -10,
      xmax: typeof args.xmax === "number" ? args.xmax : 10,
    };
    for (const k of ["a", "freq", "phase", "mu", "sigma"] as const) {
      const v = args[k];
      if (typeof v === "number") params[k] = v;
    }
    const newId = await runtime.createSignal(params);
    return { new_id: newId };
  },
};

const CREATE_IMAGE_TOOL: Tool = {
  name: "create_synthetic_image",
  description:
    "Create a new synthetic 2D image from scratch and add it to the " +
    "workspace. Use this for prompts like 'create a 2D gaussian', " +
    "'generate a ramp image', or 'add random noise image'. This is the " +
    "only way to produce an image when none exists yet.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["gauss", "ramp", "random"],
        description:
          "Image kind. 'gauss' = centred 2D gaussian (parameters: a, " +
          "sigma). 'ramp' = horizontal linear ramp. 'random' = uniform " +
          "random noise.",
      },
      title: {
        type: "string",
        description: "Display title for the new image.",
      },
      width: {
        type: "integer",
        description: "Image width in pixels (default 256).",
      },
      height: {
        type: "integer",
        description: "Image height in pixels (default 256).",
      },
      a: { type: "number", description: "Amplitude (default 1)." },
      sigma: {
        type: "number",
        description:
          "Standard deviation of the gaussian, in pixels (default 50).",
      },
    },
    required: ["kind", "title"],
    additionalProperties: false,
  },
  readonly: false,
  handler: async (runtime, args) => {
    const params: ImageCreationParams = {
      kind: args.kind as ImageCreationParams["kind"],
      title: String(args.title),
      width: typeof args.width === "number" ? args.width : 256,
      height: typeof args.height === "number" ? args.height : 256,
    };
    for (const k of ["a", "sigma"] as const) {
      const v = args[k];
      if (typeof v === "number") params[k] = v;
    }
    const newId = await runtime.createImage(params);
    return { new_id: newId };
  },
};

const APPLY_PROCESSING_TOOL: Tool = {
  name: "apply_processing",
  description:
    "Apply a processing operation to an EXISTING signal or image and " +
    "create a new object holding the result. The 'processing_id' must " +
    "come from 'list_processings'. 'params' is optional and only " +
    "honoured by operations whose 'has_params' is true. Returns the new " +
    "object id. Do NOT use this tool to CREATE a signal/image from " +
    "scratch — use 'create_synthetic_signal' or 'create_synthetic_image' " +
    "for that.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Source object id (signal or image).",
      },
      processing_id: {
        type: "string",
        description: "Processing id, as returned by 'list_processings'.",
      },
      params: {
        type: "object",
        description:
          "Optional parameter values. Use 'list_processings' first to " +
          "discover whether the operation has parameters.",
        additionalProperties: true,
      },
    },
    required: ["id", "processing_id"],
    additionalProperties: false,
  },
  readonly: false,
  handler: async (runtime, args) => {
    const id = String(args.id);
    const processingId = String(args.processing_id);
    const params =
      args.params && typeof args.params === "object"
        ? (args.params as Record<string, unknown>)
        : undefined;
    const newId = await runtime.applyProcessing(id, processingId, params);
    return { new_id: newId };
  },
};

const GET_CURRENT_PANEL_TOOL: Tool = {
  name: "get_current_panel",
  description:
    "Return which panel ('signal' or 'image') is currently active in " +
    "the UI \u2014 i.e. the one whose plot was rendered most recently. " +
    "Returns null when no plot has been rendered yet.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readonly: true,
  handler: async () => getMostRecentPanel(),
};

const CAPTURE_VIEW_TOOL: Tool = {
  name: "capture_view",
  description:
    "Capture a PNG screenshot of the currently displayed plot (signal " +
    "or image) and feed it back to the model as an inline image. Use " +
    "this whenever you need to *visually* inspect what the user sees \u2014 " +
    "e.g. to comment on the shape of a peak, the orientation of a " +
    "feature in an image, or to verify a processing result. Defaults " +
    "to the most recently rendered panel; pass 'panel' to force one.",
  parameters: {
    type: "object",
    properties: {
      panel: {
        type: "string",
        enum: ["signal", "image"],
        description:
          "Which panel to capture. Omit to capture the most recently " +
          "rendered one (recommended).",
      },
    },
    additionalProperties: false,
  },
  // Read-only: capturing the view does not mutate the workspace.
  readonly: true,
  handler: async (_runtime, args): Promise<ToolResult> => {
    const panel = (args.panel as PanelKind | undefined) ?? undefined;
    const shot = await capturePlotPng({ panel });
    return {
      ok: true,
      data: {
        panel: shot.panel,
        width: shot.width,
        height: shot.height,
        note:
          "PNG attached to the next user message so the vision model " +
          "can see it.",
      },
      followupMessages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Captured view of the ${shot.panel} panel (${shot.width}\u00d7${shot.height}px):`,
            },
            {
              type: "image_url",
              image_url: { url: shot.dataUrl, detail: "high" },
            },
          ],
        },
      ],
    };
  },
};

const CREATE_AND_RUN_MACRO_TOOL: Tool = {
  name: "create_and_run_macro",
  description:
    "Run an arbitrary Python script (a 'macro') against the workspace. " +
    "The script executes in a sandboxed Pyodide worker and has access " +
    "to the same `proxy` object exposed to user macros (see the " +
    "DataLab-Web macro documentation). The run is transient by default; " +
    "the user can choose to save the macro to the Macros panel via a " +
    "'Save to Macros' button on the result \u2014 always pick a short, " +
    "descriptive title (passed via the 'name' field, e.g. 'Generate " +
    "super-Gaussian') so the saved macro is easy to recognise. " +
    "Returns the captured stdout/stderr. Use this only when the " +
    "existing tools cannot express the required operation \u2014 e.g. " +
    "complex multi-step workflows, custom NumPy code, or features not " +
    "yet exposed as a dedicated tool.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "Python source to execute.",
      },
      name: {
        type: "string",
        description:
          "Short, descriptive title for the macro (e.g. 'Generate " +
          "super-Gaussian'). Shown in the run banner and used as the " +
          "saved title if the user clicks 'Save to Macros'. Defaults " +
          "to 'AI Assistant macro' but you should always provide a " +
          "specific name.",
      },
    },
    required: ["code"],
    additionalProperties: false,
  },
  readonly: false,
  handler: async (runtime, args) => {
    const code = String(args.code);
    const name =
      typeof args.name === "string" && args.name.trim()
        ? args.name.trim()
        : "AI Assistant macro";
    const out = await runtime.runMacroCode(code, name);
    // Echo the source under ``_macro`` so the AI Assistant transcript
    // can offer a "Save to Macros" button on user demand. The leading
    // underscore is a hint that the field is UI-only — the LLM should
    // ignore it (it's not part of the macro's actual stdout/stderr).
    return { ...out, _macro: { name, code } };
  },
};

const GET_MACRO_CONSOLE_OUTPUT_TOOL: Tool = {
  name: "get_macro_console_output",
  description:
    "Return the buffered stdout/stderr from the most recent macro " +
    "executed via 'create_and_run_macro' (or null when no macro has " +
    "run yet). Useful when the previous tool result was truncated.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  readonly: true,
  handler: async (runtime) => runtime.lastMacroOutput,
};

/** Default tool registry shipped in v1. */
export const BUILTIN_TOOLS: Tool[] = [
  LIST_PANELS_TOOL,
  LIST_SIGNALS_TOOL,
  LIST_IMAGES_TOOL,
  GET_SIGNAL_SUMMARY_TOOL,
  GET_IMAGE_META_TOOL,
  LIST_PROCESSINGS_TOOL,
  CREATE_SIGNAL_TOOL,
  CREATE_IMAGE_TOOL,
  APPLY_PROCESSING_TOOL,
  GET_CURRENT_PANEL_TOOL,
  CAPTURE_VIEW_TOOL,
  CREATE_AND_RUN_MACRO_TOOL,
  GET_MACRO_CONSOLE_OUTPUT_TOOL,
];

/** Build a name-keyed lookup table for fast dispatch. */
export function indexTools(tools: Tool[]): Map<string, Tool> {
  const out = new Map<string, Tool>();
  for (const tool of tools) {
    out.set(tool.name, tool);
  }
  return out;
}

/** Run a tool and wrap any thrown error as a structured ToolResult.
 *
 *  Handlers may either return a plain JSON-friendly value (wrapped
 *  into ``ToolResult.data``) or a fully-built :type:`ToolResult` \u2014 the
 *  latter is required for multimodal tools that need to attach
 *  ``followupMessages`` (e.g. ``capture_view``). */
export async function callTool(
  tool: Tool,
  runtime: RuntimeApi,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const value = await tool.handler(runtime, args);
    if (isToolResult(value)) return value;
    return { ok: true, data: value };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
