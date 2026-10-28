import { describe, expect, it, vi } from "vitest";
import {
  approvalKey,
  BUILTIN_TOOLS,
  callTool,
  indexTools,
  isNonExecutingMacroCall,
} from "../../../src/aiassistant/tools";
import type { DataLabRuntime } from "../../../src/runtime/runtime";

function fakeRuntime(over: Partial<DataLabRuntime>): DataLabRuntime {
  return over as DataLabRuntime;
}

describe("aiassistant/tools", () => {
  it("indexes tools by name", () => {
    const idx = indexTools(BUILTIN_TOOLS);
    expect(idx.get("list_signals")).toBeDefined();
    expect(idx.get("apply_processing")).toBeDefined();
    expect(idx.size).toBe(BUILTIN_TOOLS.length);
  });

  it("flags create_synthetic_signal/_image, apply_processing and create_and_run_macro as the only mutating tools", () => {
    const mutating = BUILTIN_TOOLS.filter((t) => !t.readonly).map(
      (t) => t.name,
    );
    expect(mutating.sort()).toEqual(
      [
        "apply_processing",
        "create_and_run_macro",
        "create_synthetic_image",
        "create_synthetic_signal",
      ].sort(),
    );
  });

  it("forwards list_signals to runtime.listSignals", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("list_signals")!;
    const runtime = fakeRuntime({
      listSignals: vi.fn(async () => [
        {
          id: "s1",
          uuid: null,
          title: "Sine",
          size: 100,
          xlabel: "",
          ylabel: "",
          xunit: "",
          yunit: "",
        },
      ]),
    });
    const result = await callTool(tool, runtime, {});
    expect(result.ok).toBe(true);
    expect(runtime.listSignals).toHaveBeenCalledOnce();
    expect((result.data as Array<{ id: string }>)[0]?.id).toBe("s1");
  });

  it("summarises signal data without echoing the full y array", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("get_signal_summary")!;
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => i * 2);
    const runtime = fakeRuntime({
      getSignalData: vi.fn(async () => ({
        id: "s1",
        uuid: null,
        title: "Linear",
        size: 100,
        xlabel: "",
        ylabel: "",
        xunit: "",
        yunit: "",
        x,
        y,
      })),
      getObjectStats: vi.fn(async () => ({
        kind: "signal" as const,
        n_points: 100,
        x_dtype: "float64",
        y_dtype: "float64",
        x_min: 0,
        x_max: 99,
        y_min: 0,
        y_max: 198,
        y_mean: 99,
        y_std: 57.73,
        y_median: 99,
      })),
    });
    const result = (await callTool(tool, runtime, { id: "s1" })).data as Record<
      string,
      unknown
    >;
    expect(result.n).toBe(100);
    expect(result.y_min).toBe(0);
    expect(result.y_max).toBe(198);
    expect((result.first_y as number[]).length).toBe(8);
    expect((result.last_y as number[]).length).toBe(8);
    // Crucially: no full y array
    expect(result).not.toHaveProperty("y");
  });

  it("forwards apply_processing arguments to runtime.applyProcessing", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("apply_processing")!;
    const apply = vi.fn(async () => "new-id");
    const runtime = fakeRuntime({
      applyProcessing: apply,
    });
    const result = await callTool(tool, runtime, {
      id: "s1",
      processing_id: "fft",
      params: { window: "hann" },
    });
    expect(apply).toHaveBeenCalledWith("s1", "fft", { window: "hann" });
    expect(result.ok).toBe(true);
    expect((result.data as { new_id: string }).new_id).toBe("new-id");
  });

  it("captures handler errors as ok=false results", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("list_signals")!;
    const runtime = fakeRuntime({
      listSignals: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const result = await callTool(tool, runtime, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
  });

  it("forwards create_synthetic_signal to runtime.createSignal", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("create_synthetic_signal")!;
    const createSignal = vi.fn(async () => "sig-42");
    const runtime = fakeRuntime({ createSignal });
    const result = await callTool(tool, runtime, {
      kind: "gauss",
      title: "MyGauss",
      mu: 0,
      sigma: 1,
    });
    expect(createSignal).toHaveBeenCalledTimes(1);
    const args = createSignal.mock.calls[0]![0];
    expect(args).toMatchObject({
      kind: "gauss",
      title: "MyGauss",
      size: 500,
      xmin: -10,
      xmax: 10,
      mu: 0,
      sigma: 1,
    });
    expect(result.ok).toBe(true);
    expect((result.data as { new_id: string }).new_id).toBe("sig-42");
  });

  it("forwards create_synthetic_image to runtime.createImage", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("create_synthetic_image")!;
    const createImage = vi.fn(async () => "img-7");
    const runtime = fakeRuntime({ createImage });
    const result = await callTool(tool, runtime, {
      kind: "gauss",
      title: "MyGauss2D",
      width: 128,
      height: 128,
      sigma: 16,
    });
    const args = createImage.mock.calls[0]![0];
    expect(args).toMatchObject({
      kind: "gauss",
      title: "MyGauss2D",
      width: 128,
      height: 128,
      sigma: 16,
    });
    expect(result.ok).toBe(true);
    expect((result.data as { new_id: string }).new_id).toBe("img-7");
  });

  it("runs create_and_run_macro by default and echoes the macro source", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("create_and_run_macro")!;
    const runMacroCode = vi.fn(async () => ({
      stdout: "hi\n",
      stderr: "",
      status: "ok" as const,
    }));
    const lintMacro = vi.fn();
    const runtime = fakeRuntime({ runMacroCode, lintMacro });
    const result = await callTool(tool, runtime, {
      code: "print('hi')",
      name: "Say hi",
    });
    expect(runMacroCode).toHaveBeenCalledWith("print('hi')", "Say hi");
    expect(lintMacro).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      stdout: "hi\n",
      status: "ok",
      _macro: { name: "Say hi", code: "print('hi')" },
    });
  });

  it("only checks and offers the macro when autorun is false", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("create_and_run_macro")!;
    const runMacroCode = vi.fn();
    const lintMacro = vi.fn(async () => ({
      ok: false,
      syntax_error: { line: 1, col: 5, message: "invalid syntax" },
      unknown_methods: [],
      missing_await: [],
      proxy_calls: [],
    }));
    const runtime = fakeRuntime({ runMacroCode, lintMacro });
    const result = await callTool(tool, runtime, {
      code: "x = (",
      name: "Broken",
      autorun: false,
    });
    expect(runMacroCode).not.toHaveBeenCalled();
    expect(lintMacro).toHaveBeenCalledWith("x = (");
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      autorun: false,
      syntax_error: { line: 1, message: "invalid syntax" },
      _macro: { name: "Broken", code: "x = (" },
    });
  });

  it("declares a documented autorun parameter on create_and_run_macro", () => {
    const tool = indexTools(BUILTIN_TOOLS).get("create_and_run_macro")!;
    const props = tool.parameters.properties as Record<
      string,
      { type: string; description?: string }
    >;
    expect(props.autorun?.type).toBe("boolean");
    expect(props.autorun?.description).toMatch(/without executing/i);
  });

  it("reads get_macro_console_output through getLastMacroOutput", async () => {
    const tool = indexTools(BUILTIN_TOOLS).get("get_macro_console_output")!;
    const out = { stdout: "done\n", stderr: "", status: "ok" as const };
    const getLastMacroOutput = vi.fn(async () => out);
    const result = await callTool(
      tool,
      fakeRuntime({ getLastMacroOutput }),
      {},
    );
    expect(getLastMacroOutput).toHaveBeenCalledOnce();
    expect(result.data).toEqual(out);
  });

  it("remembers approvals of non-executing macros under their own key", () => {
    expect(
      isNonExecutingMacroCall("create_and_run_macro", { autorun: false }),
    ).toBe(true);
    expect(isNonExecutingMacroCall("create_and_run_macro", {})).toBe(false);
    expect(
      isNonExecutingMacroCall("apply_processing", { autorun: false }),
    ).toBe(false);
    expect(approvalKey("create_and_run_macro", { autorun: false })).not.toBe(
      approvalKey("create_and_run_macro", { autorun: true }),
    );
    expect(approvalKey("create_and_run_macro", {})).toBe(
      "create_and_run_macro",
    );
  });
});
