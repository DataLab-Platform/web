/** Shared, data-only description of the agent-facing tool surface. */

export interface ExternalToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readonly: boolean;
}

const PANEL = {
  type: "string",
  enum: ["signal", "image"],
  description: "DataLab panel; defaults to the active data panel.",
};
const REF = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  description:
    "Persistent UUID or current DataLab-Web object id, never a title.",
};
const OPERATION = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  description: "Exact built-in operation id from list_available_operations.",
};
const REFS = {
  type: "array",
  items: REF,
  minItems: 1,
  maxItems: 32,
  uniqueItems: true,
};
const PAGING = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 50 },
};
const empty = { type: "object", properties: {}, additionalProperties: false };
const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });

export const EXTERNAL_TOOLS: ExternalToolDescriptor[] = [
  {
    name: "list_objects",
    description:
      "List signals or images with current ids, persistent UUIDs, titles, units and groups. Results are paginated.",
    parameters: objectSchema({ panel: PANEL, ...PAGING }),
    readonly: true,
  },
  {
    name: "get_current_panel",
    description: "Return the active DataLab panel.",
    parameters: empty,
    readonly: true,
  },
  {
    name: "get_selection",
    description:
      "Read the user's current selection with titles, current ids and persistent UUIDs.",
    parameters: empty,
    readonly: true,
  },
  {
    name: "select_objects",
    description:
      "Select identified objects in DataLab for visual inspection; this does not change scientific data.",
    parameters: objectSchema({ uuids: REFS, panel: PANEL }, ["uuids"]),
    readonly: true,
  },
  {
    name: "get_object_info",
    description:
      "Inspect one object without transferring its full arrays: identity, statistics, units, ROI, metadata and last processing.",
    parameters: objectSchema({ nb_id_title: REF, panel: PANEL }),
    readonly: true,
  },
  {
    name: "list_available_operations",
    description:
      "Discover built-in computations. List paginated operation ids, or provide an exact name to inspect its parameter schema and defaults.",
    parameters: objectSchema({
      panel: PANEL,
      name: OPERATION,
      target_uuid: REF,
      ...PAGING,
    }),
    readonly: true,
  },
  {
    name: "apply_operation",
    description:
      "Apply a discovered built-in processing or analysis to explicit object ids/UUIDs, or to the current selection. Returns created objects or analysis results.",
    parameters: objectSchema(
      {
        name: OPERATION,
        panel: PANEL,
        parameters: { type: "object", additionalProperties: true },
        target_uuid: REF,
        target_uuids: REFS,
        operand_uuid: REF,
      },
      ["name"],
    ),
    readonly: false,
  },
  {
    name: "get_results",
    description:
      "Read stored analysis results for identified objects or the current selection; rows are bounded.",
    parameters: objectSchema({ uuids: REFS, panel: PANEL }),
    readonly: true,
  },
  {
    name: "capture_view",
    description:
      "Capture the currently rendered DataLab plot as a PNG for visual inspection.",
    parameters: objectSchema({ panel: PANEL }),
    readonly: true,
  },
  {
    name: "create_synthetic_signal",
    description:
      "Create a synthetic sine, cosine, Gaussian or noise signal in DataLab.",
    parameters: objectSchema(
      {
        kind: { type: "string", enum: ["sine", "cosine", "gauss", "noise"] },
        title: { type: "string", minLength: 1, maxLength: 256 },
        size: { type: "integer", minimum: 1, maximum: 1_000_000 },
        xmin: { type: "number" },
        xmax: { type: "number" },
        a: { type: "number" },
        freq: { type: "number" },
        phase: { type: "number" },
        mu: { type: "number" },
        sigma: { type: "number", exclusiveMinimum: 0 },
      },
      ["kind", "title"],
    ),
    readonly: false,
  },
  {
    name: "create_synthetic_image",
    description:
      "Create a synthetic Gaussian, ramp or random-noise image in DataLab.",
    parameters: objectSchema(
      {
        kind: { type: "string", enum: ["gauss", "ramp", "random"] },
        title: { type: "string", minLength: 1, maxLength: 256 },
        width: { type: "integer", minimum: 1, maximum: 4096 },
        height: { type: "integer", minimum: 1, maximum: 4096 },
        a: { type: "number" },
        sigma: { type: "number", exclusiveMinimum: 0 },
      },
      ["kind", "title"],
    ),
    readonly: false,
  },
];
