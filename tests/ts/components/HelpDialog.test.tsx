import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HelpDialog } from "../../../src/components/HelpDialog";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";
import type { PythonEnvironmentInfo } from "../../../src/runtime/runtime";

const PYTHON_INFO: PythonEnvironmentInfo = {
  pythonVersion: "3.12.1",
  pythonImplementation: "CPython",
  pythonPlatform: "emscripten",
  platform: "Emscripten-wasm32",
  machine: "wasm32",
  pyodideVersion: "0.26.4",
  packages: [
    { name: "numpy", version: "2.0.2" },
    { name: "Sigima", version: "1.3.0" },
  ],
};

function runtimeWith(
  result: Promise<PythonEnvironmentInfo> = Promise.resolve(PYTHON_INFO),
): RuntimeApi {
  return {
    getPythonEnvironmentInfo: vi.fn(() => result),
    getStorageMode: vi.fn(() => "ram"),
  } as unknown as RuntimeApi;
}

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function setClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("HelpDialog environment view", () => {
  it("loads and renders the runtime and package details", async () => {
    render(
      <HelpDialog
        view="environment"
        onClose={vi.fn()}
        appVersion="0.8.0"
        runtime={runtimeWith()}
        runtimeStatus="ready"
      />,
    );

    expect(
      screen.getByText("Collecting environment information…"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Python distributions (2)")).toBeVisible();
    expect(screen.getByText("0.8.0")).toBeVisible();
    expect(screen.getByText("3.12.1")).toBeVisible();
    expect(screen.getByText("Sigima")).toBeVisible();
    expect(screen.getByText("1.3.0")).toBeVisible();
  });

  it("copies the complete Markdown report and confirms success", async () => {
    setClipboard(() => Promise.resolve());
    render(
      <HelpDialog
        view="environment"
        onClose={vi.fn()}
        appVersion="0.8.0"
        runtime={runtimeWith()}
        runtimeStatus="ready"
      />,
    );

    const copyButton = await screen.findByRole("button", {
      name: "Copy report",
    });
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledOnce(),
    );
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(copied).toContain("## DataLab Web environment");
    expect(copied).toContain("| Sigima | 1.3.0 |");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Copied!",
    );
  });

  it("shows partial diagnostics and clipboard failures", async () => {
    setClipboard(() => Promise.reject(new Error("denied")));
    render(
      <HelpDialog
        view="environment"
        onClose={vi.fn()}
        appVersion="dev"
        runtime={null}
        runtimeStatus="error"
      />,
    );

    expect(
      await screen.findByText("The Python runtime is unavailable."),
    ).toBeVisible();
    expect(screen.getByText("Web environment")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    expect(
      await screen.findByText("Clipboard access was denied."),
    ).toBeVisible();
  });
});
