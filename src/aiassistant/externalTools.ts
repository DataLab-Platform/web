/**
 * Agent-facing tools for embedded hosts. Unlike the in-app assistant's
 * registry, this surface never dispatches macros or plugin contributions.
 */

import { validateDataSetValues } from "../components/DataSetForm";
import { numericValueValid } from "../components/DataSetForm/rangeValidation";
import type {
  AnalysisResult,
  FeatureDescriptor,
  ObjectNode,
  PanelKind,
  RuntimeApi,
  SchemaWithValues,
  SignalAnalysisDescriptor,
} from "../runtime/runtime";
import { capturePlotPng } from "./plotCapture";
import { BUILTIN_TOOLS } from "./tools";
import type { Tool } from "./types";
import {
  EXTERNAL_TOOLS,
  type ExternalToolDescriptor,
} from "./externalToolManifest";

export interface ExternalToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** PNG is outside the bounded JSON payload and is intended for vision APIs. */
  imageDataUrl?: string;
}

export interface ExternalToolContext {
  getCurrentPanel?: () => string;
  getSelection?: () => string[];
  selectObjects?: (ids: string[], panel: string | null) => void | Promise<void>;
  onModelChanged: (panel: PanelKind, resultIds?: string[]) => void;
}

type Args = Record<string, unknown>;
type ObjectRef = ObjectNode & { group: string };
type Operation =
  | { type: "processing"; panel: PanelKind; entry: FeatureDescriptor }
  | { type: "analysis"; panel: PanelKind; entry: SignalAnalysisDescriptor };

function builtinCreationTool(name: string): Tool {
  const tool = BUILTIN_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`The DataLab tool ${name} is not registered.`);
  return tool;
}

const createSignal = builtinCreationTool("create_synthetic_signal");
const createImage = builtinCreationTool("create_synthetic_image");

const MAX_JSON_BYTES = 20_000;

function isRecord(value: unknown): value is Args {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("Arguments are nested too deeply.");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => validateJson(item, depth + 1));
    return;
  }
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach((item) => validateJson(item, depth + 1));
    return;
  }
  throw new Error("Arguments must contain finite JSON values.");
}

function validateArgument(value: unknown, schema: Args, label: string): void {
  if (schema.type === "object") {
    if (!isRecord(value)) throw new Error(`${label} must be an object.`);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in value))
        throw new Error(`${label}.${key} is required.`);
    }
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key];
      if (!isRecord(property)) {
        if (schema.additionalProperties !== true)
          throw new Error(`Unknown argument ${label}.${key}.`);
        continue;
      }
      validateArgument(item, property, `${label}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      throw new Error(`${label} must not be empty.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      throw new Error(
        `${label} has too many items (maximum ${schema.maxItems}).`,
      );
    if (schema.uniqueItems === true && new Set(value).size !== value.length)
      throw new Error(`${label} must not contain duplicates.`);
    if (isRecord(schema.items)) {
      for (const item of value) validateArgument(item, schema.items, label);
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string")
      throw new Error(`${label} must be a string.`);
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      throw new Error(`${label} must not be empty.`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      throw new Error(`${label} is too long.`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value))
    )
      throw new Error(`${label} must be a finite ${schema.type}.`);
    if (typeof schema.minimum === "number" && value < schema.minimum)
      throw new Error(`${label} must be at least ${schema.minimum}.`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      throw new Error(`${label} must be at most ${schema.maximum}.`);
    if (
      typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum
    )
      throw new Error(
        `${label} must be greater than ${schema.exclusiveMinimum}.`,
      );
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new Error(`${label} must be one of: ${schema.enum.join(", ")}.`);
  }
}

function panelFrom(args: Args, context: ExternalToolContext): PanelKind {
  const panel = args.panel ?? context.getCurrentPanel?.();
  if (panel !== "signal" && panel !== "image") {
    throw new Error("Select the signal or image panel, or specify panel.");
  }
  return panel;
}

async function objects(
  runtime: RuntimeApi,
  panel?: PanelKind,
): Promise<ObjectRef[]> {
  const trees = await Promise.all(
    (panel ? [panel] : (["signal", "image"] as const)).map((kind) =>
      runtime.getPanelTree(kind),
    ),
  );
  return trees.flatMap((tree) =>
    tree.groups.flatMap((group) =>
      group.objects.map((object) => ({ ...object, group: group.name })),
    ),
  );
}

function resolveRef(reference: string, available: ObjectRef[]): ObjectRef {
  const matches = available.filter(
    (object) => object.id === reference || object.uuid === reference,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Object id or UUID not found: ${reference}.`
        : `Ambiguous object id or UUID: ${reference}.`,
    );
  }
  return matches[0];
}

function selection(context: ExternalToolContext): string[] {
  if (!context.getSelection)
    throw new Error("The DataLab selection is unavailable.");
  return [...context.getSelection()];
}

function requestedRefs(
  args: Args,
  context: ExternalToolContext,
  arrayName: string,
): string[] {
  const value = args[arrayName];
  const refs = Array.isArray(value) ? value : selection(context);
  if (refs.length === 0) throw new Error("No DataLab objects are selected.");
  if (refs.length > 32) throw new Error("Select at most 32 objects at a time.");
  return refs as string[];
}

function page<T>(items: T[], args: Args) {
  const offset = typeof args.offset === "number" ? args.offset : 0;
  const limit = typeof args.limit === "number" ? args.limit : 30;
  const next = offset + limit;
  return {
    items: items.slice(offset, next),
    total: items.length,
    offset,
    next_offset: next < items.length ? next : null,
  };
}

async function operations(
  runtime: RuntimeApi,
  panel: PanelKind,
): Promise<Operation[]> {
  const [features, analyses] = await Promise.all([
    runtime.listFeatures(),
    panel === "signal"
      ? runtime.listSignalAnalysis()
      : runtime.listImageAnalysis(),
  ]);
  if (
    features.some((entry) => typeof entry.builtin !== "boolean") ||
    analyses.some((entry) => typeof entry.builtin !== "boolean")
  ) {
    throw new Error(
      "The operation catalogue does not identify plugin contributions.",
    );
  }
  return [
    ...features
      .filter((entry) => entry.builtin && entry.object_kind === panel)
      .map((entry): Operation => ({ type: "processing", panel, entry })),
    ...analyses
      .filter((entry) => entry.builtin)
      .map((entry): Operation => ({ type: "analysis", panel, entry })),
  ];
}

function describeOperation(op: Operation) {
  return {
    id: op.entry.id,
    label: op.entry.label,
    panel: op.panel,
    pattern: op.type === "analysis" ? "1_to_0" : op.entry.pattern,
    has_params: op.entry.has_params,
    output_panel: op.type === "processing" ? op.entry.output_kind : null,
  };
}

function findOperation(catalog: Operation[], name: string): Operation {
  const matches = catalog.filter((op) => op.entry.id === name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Ambiguous operation id: ${name}.`);
  const needle = name.toLowerCase();
  const suggestions = catalog
    .map((op) => op.entry.id)
    .filter(
      (id) =>
        id.toLowerCase().includes(needle) || needle.includes(id.toLowerCase()),
    )
    .slice(0, 5);
  throw new Error(
    `Unknown built-in operation: ${name}.` +
      (suggestions.length
        ? ` Similar operations: ${suggestions.join(", ")}.`
        : ""),
  );
}

async function operationSchema(
  runtime: RuntimeApi,
  operation: Operation,
  source?: string,
): Promise<SchemaWithValues | null> {
  if (!operation.entry.has_params) return null;
  const payload =
    operation.type === "processing"
      ? await runtime.getFeatureSchema(operation.entry.id, source)
      : source
        ? await (operation.panel === "signal"
            ? runtime.getSignalAnalysisParamSchema(source, operation.entry.id)
            : runtime.getImageAnalysisParamSchema(source, operation.entry.id))
        : null;
  if (!payload) {
    throw new Error(
      "Select a source object to inspect this operation's parameters.",
    );
  }
  if (
    !isRecord(payload) ||
    !isRecord(payload.schema) ||
    !isRecord(payload.values)
  ) {
    throw new Error("DataLab returned an invalid parameter schema.");
  }
  return { schema: payload.schema, values: payload.values };
}

async function validatedParameters(
  runtime: RuntimeApi,
  operation: Operation,
  source: string,
  supplied: unknown,
): Promise<Args | null> {
  const provided = isRecord(supplied) ? supplied : {};
  const payload = await operationSchema(runtime, operation, source);
  if (!payload) {
    if (Object.keys(provided).length)
      throw new Error(`Operation ${operation.entry.id} accepts no parameters.`);
    return null;
  }
  const properties = isRecord(payload.schema.properties)
    ? payload.schema.properties
    : {};
  const values = { ...payload.values, ...provided };
  const active =
    operation.type === "processing"
      ? await runtime.resolveFeatureActive(operation.entry.id, values)
      : await runtime.resolveAnalysisActive(
          operation.panel,
          operation.entry.id,
          values,
        );
  for (const [name, value] of Object.entries(provided)) {
    const prop = properties[name];
    if (!isRecord(prop)) throw new Error(`Unknown parameter: ${name}.`);
    if (
      prop.readOnly === true ||
      prop["x-guidata-transient"] === true ||
      active[name] === false
    )
      throw new Error(`Parameter ${name} is not editable for these values.`);
    if (
      value === null &&
      (payload.values[name] === null || prop["x-guidata-allow-none"] === true)
    )
      continue;
    if (prop.type === "number" || prop.type === "integer") {
      if (
        !numericValueValid(prop, value) ||
        (prop.type === "integer" && !Number.isInteger(value))
      ) {
        throw new Error(`Invalid numeric parameter ${name}.`);
      }
    } else if (prop.type === "string" && typeof value !== "string") {
      throw new Error(`Parameter ${name} must be a string.`);
    } else if (prop.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`Parameter ${name} must be a boolean.`);
    } else if (prop.type === "array" && !Array.isArray(value)) {
      throw new Error(`Parameter ${name} must be an array.`);
    } else if (prop.type === "object" && !isRecord(value)) {
      throw new Error(`Parameter ${name} must be an object.`);
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value))
      throw new Error(
        `Parameter ${name} must be one of: ${prop.enum.join(", ")}.`,
      );
  }
  if (!validateDataSetValues(payload.schema, values, active)) {
    throw new Error(
      "The operation parameters do not satisfy their DataLab schema.",
    );
  }
  return values;
}

function summary(object: ObjectRef) {
  return {
    id: object.id,
    uuid: object.uuid,
    title: object.title.slice(0, 512),
    title_truncated: object.title.length > 512,
    kind: object.kind,
    group: object.group.slice(0, 512),
    size: object.size,
    xlabel: object.xlabel,
    ylabel: object.ylabel,
    xunit: object.xunit,
    yunit: object.yunit,
  };
}

function compactResult(result: AnalysisResult) {
  const rows =
    result.data ?? (result.category === "geometry" ? result.coords : []);
  return {
    category: result.category,
    kind: result.kind,
    title: result.title,
    func_name: result.func_name,
    headers: result.headers,
    roi_indices: result.roi_indices?.slice(0, 20) ?? null,
    data: rows.slice(0, 20),
    row_count: rows.length,
    truncated: rows.length > 20,
  };
}

async function reveal(
  context: ExternalToolContext,
  ids: string[],
  panel: PanelKind,
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    context.onModelChanged(panel);
    if (!context.selectObjects)
      throw new Error("The DataLab selection UI is unavailable.");
    await context.selectObjects([ids[ids.length - 1]], panel);
  } catch (error) {
    warnings.push(
      `The operation succeeded, but the result could not be shown: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return warnings;
}

async function dispatch(
  runtime: RuntimeApi,
  context: ExternalToolContext,
  name: string,
  args: Args,
): Promise<ExternalToolResult> {
  if (name === "get_current_panel") {
    const panel = context.getCurrentPanel?.();
    if (!panel) throw new Error("The current DataLab panel is unavailable.");
    return { ok: true, data: { panel } };
  }
  if (name === "list_objects") {
    const panel = panelFrom(args, context);
    const result = page((await objects(runtime, panel)).map(summary), args);
    return {
      ok: true,
      data: { panel, objects: result.items, ...result, items: undefined },
    };
  }
  if (name === "get_selection") {
    const panel = panelFrom(args, context);
    const refs = selection(context);
    const available = await objects(runtime, panel);
    return {
      ok: true,
      data: {
        panel,
        objects: refs.map((ref) => summary(resolveRef(ref, available))),
      },
    };
  }
  if (name === "select_objects") {
    const available = await objects(runtime);
    const selected = (args.uuids as string[]).map((ref) =>
      resolveRef(ref, available),
    );
    const panel = args.panel ?? selected[0].kind;
    if (selected.some((obj) => obj.kind !== panel))
      throw new Error("All selected objects must belong to the same panel.");
    if (!context.selectObjects)
      throw new Error("The DataLab selection UI is unavailable.");
    await context.selectObjects(
      selected.map((obj) => obj.id),
      panel as PanelKind,
    );
    return { ok: true, data: { panel, objects: selected.map(summary) } };
  }
  if (name === "get_object_info") {
    const ref =
      typeof args.nb_id_title === "string"
        ? args.nb_id_title
        : requestedRefs(args, context, "uuids")[0];
    const requestedPanel =
      args.panel !== undefined || typeof args.nb_id_title !== "string"
        ? panelFrom(args, context)
        : undefined;
    const object = resolveRef(ref, await objects(runtime, requestedPanel));
    const panel = object.kind;
    const [stats, roi, metadata, lastProcessing, preview] = await Promise.all([
      runtime.getObjectStats(object.id),
      panel === "signal"
        ? runtime.getSignalRoi(object.id)
        : runtime.getImageRoi(object.id),
      runtime.listObjectMetadata(object.id),
      runtime.getLastProcessing(object.id),
      panel === "signal" ? runtime.getSignalDataPreview(object.id, 8, 8) : null,
    ]);
    return {
      ok: true,
      data: {
        ...summary(object),
        stats,
        roi: roi.slice(0, 20),
        roi_count: roi.length,
        metadata: metadata.slice(0, 20).map((entry) => ({
          ...entry,
          value: entry.value.slice(0, 512),
          truncated: entry.value.length > 512,
        })),
        metadata_count: metadata.length,
        last_processing: lastProcessing,
        preview,
      },
    };
  }
  if (name === "list_available_operations") {
    const panel = panelFrom(args, context);
    const catalog = await operations(runtime, panel);
    if (typeof args.name !== "string") {
      const result = page(catalog.map(describeOperation), args);
      return {
        ok: true,
        data: { panel, operations: result.items, ...result, items: undefined },
      };
    }
    const operation = findOperation(catalog, args.name);
    const requested =
      typeof args.target_uuid === "string"
        ? args.target_uuid
        : selection(context)[0];
    const source = requested
      ? resolveRef(requested, await objects(runtime, panel)).id
      : undefined;
    const parameters = await operationSchema(runtime, operation, source);
    return { ok: true, data: { ...describeOperation(operation), parameters } };
  }
  if (name === "get_results") {
    const panel = panelFrom(args, context);
    const available = await objects(runtime, panel);
    const selected = requestedRefs(args, context, "uuids").map((ref) =>
      resolveRef(ref, available),
    );
    const results = await Promise.all(
      selected.map(async (object) => ({
        object: summary(object),
        results: (panel === "signal"
          ? await runtime.listSignalResults(object.id)
          : await runtime.listImageResults(object.id)
        ).map(compactResult),
      })),
    );
    return { ok: true, data: { results } };
  }
  if (name === "capture_view") {
    const panel =
      typeof args.panel === "string" ? panelFrom(args, context) : undefined;
    const shot = await capturePlotPng({ panel });
    return {
      ok: true,
      data: { panel: shot.panel, width: shot.width, height: shot.height },
      imageDataUrl: shot.dataUrl,
    };
  }
  if (name === "create_synthetic_signal" || name === "create_synthetic_image") {
    if (
      typeof args.xmin === "number" &&
      typeof args.xmax === "number" &&
      args.xmin >= args.xmax
    )
      throw new Error("xmin must be smaller than xmax.");
    if (Number(args.width ?? 256) * Number(args.height ?? 256) > 4_194_304)
      throw new Error("Synthetic images are limited to 4,194,304 pixels.");
    const tool =
      name === "create_synthetic_signal" ? createSignal : createImage;
    const created = await tool.handler(runtime, args);
    if (!isRecord(created) || typeof created.new_id !== "string")
      throw new Error("DataLab returned an invalid created-object id.");
    const panel = name === "create_synthetic_signal" ? "signal" : "image";
    const warnings = await reveal(context, [created.new_id], panel);
    let object: ObjectRef;
    try {
      object = resolveRef(created.new_id, await objects(runtime, panel));
    } catch (error) {
      throw new Error(
        `Object ${created.new_id} was created, but its details could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    return { ok: true, data: { created: [summary(object)], warnings } };
  }
  if (name === "apply_operation") {
    if (args.target_uuid !== undefined && args.target_uuids !== undefined)
      throw new Error("Use either target_uuid or target_uuids, not both.");
    const refs =
      typeof args.target_uuid === "string"
        ? [args.target_uuid]
        : requestedRefs(args, context, "target_uuids");
    const available = await objects(runtime);
    const sources = refs.map((ref) => resolveRef(ref, available));
    if (new Set(sources.map((source) => source.id)).size !== sources.length)
      throw new Error("The same target object was specified more than once.");
    const panel = args.panel ?? sources[0].kind;
    if (
      (panel !== "signal" && panel !== "image") ||
      sources.some((s) => s.kind !== panel)
    )
      throw new Error("All target objects must belong to the requested panel.");
    const operation = findOperation(
      await operations(runtime, panel),
      args.name as string,
    );
    const ids = sources.map((source) => source.id);
    const operand =
      typeof args.operand_uuid === "string"
        ? resolveRef(args.operand_uuid, available)
        : null;
    if (operand && operand.kind !== panel)
      throw new Error(
        "The operand must belong to the same panel as the targets.",
      );
    if (operation.type === "analysis" && operand)
      throw new Error("Analysis operations do not accept an operand.");
    if (
      operation.type === "processing" &&
      (operation.entry.pattern === "2_to_1") !== !!operand
    )
      throw new Error(
        operation.entry.pattern === "2_to_1"
          ? "This operation requires operand_uuid."
          : "This operation does not accept operand_uuid.",
      );
    const params = await validatedParameters(
      runtime,
      operation,
      ids[0],
      args.parameters,
    );
    if (operation.type === "processing") {
      await runtime.checkFeatureInputs(
        operation.entry.id,
        ids,
        operand?.id ?? null,
        params,
      );
      const created = await runtime.applyFeature(
        operation.entry.id,
        ids,
        operand?.id ?? null,
        params,
      );
      if (!created.length)
        throw new Error("The operation returned no objects.");
      const warnings = await reveal(
        context,
        created,
        operation.entry.output_kind,
      );
      let output: ObjectRef[];
      try {
        output = await objects(runtime, operation.entry.output_kind);
      } catch (error) {
        throw new Error(
          `The operation created ${created.join(", ")}, but their details could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
      return {
        ok: true,
        data: {
          operation: describeOperation(operation),
          created: created.map((id) => summary(resolveRef(id, output))),
          warnings,
        },
      };
    }
    const results: {
      object: ReturnType<typeof summary>;
      result?: ReturnType<typeof compactResult> | null;
      error?: string;
    }[] = [];
    for (const object of sources) {
      try {
        const result =
          panel === "signal"
            ? await runtime.runSignalAnalysis(
                object.id,
                operation.entry.id,
                params,
              )
            : await runtime.runImageAnalysis(
                object.id,
                operation.entry.id,
                params,
              );
        results.push({
          object: summary(object),
          result: result ? compactResult(result) : null,
        });
      } catch (error) {
        results.push({
          object: summary(object),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const succeeded = results.filter((result) => !result.error);
    const warnings: string[] = [];
    if (succeeded.length) {
      try {
        context.onModelChanged(
          panel,
          succeeded.map((item) => item.object.id),
        );
      } catch (error) {
        warnings.push(
          `Analysis results were saved, but the display could not be refreshed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const failures = results.filter((result) => result.error).length;
    return {
      ok: failures === 0,
      data: { operation: describeOperation(operation), results, warnings },
      ...(failures
        ? {
            error: `${failures} analysis call(s) failed; other results may have been saved.`,
          }
        : {}),
    };
  }
  throw new Error(`Unknown external tool: ${name}.`);
}

export function listExternalTools(): ExternalToolDescriptor[] {
  return EXTERNAL_TOOLS;
}

export async function callExternalTool(
  runtime: RuntimeApi,
  context: ExternalToolContext,
  name: string,
  input: unknown,
): Promise<ExternalToolResult> {
  const tool = EXTERNAL_TOOLS.find((entry) => entry.name === name);
  if (!tool) return { ok: false, error: `Unknown external tool: ${name}.` };
  try {
    validateJson(input);
    validateArgument(input, tool.parameters, "args");
    if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_JSON_BYTES)
      throw new Error("Tool arguments exceed the 20 kB limit.");
    const result = await dispatch(runtime, context, name, input as Args);
    const { imageDataUrl, ...json } = result;
    if (
      new TextEncoder().encode(JSON.stringify(json)).length > MAX_JSON_BYTES
    ) {
      return {
        ok: false,
        error: tool.readonly
          ? "The response exceeds 20 kB; request fewer objects or a narrower page."
          : "The operation may have modified the workspace, but its response exceeds 20 kB. Inspect the objects and results before retrying.",
      };
    }
    return { ...json, ...(imageDataUrl ? { imageDataUrl } : {}) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
