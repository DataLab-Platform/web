import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DialogBridge } from "../../../src/components/DialogBridge";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";

type Handler = (kind: string, payload: unknown) => Promise<unknown>;

const runtimeMock = vi.hoisted(() => ({
  handler: null as Handler | null,
  setDialogHandler: vi.fn((handler: Handler | null) => {
    runtimeMock.handler = handler;
  }),
  resolveBridgeActive: vi.fn(async () => ({})),
  resolveBridgeCallbacks: vi.fn(
    async (_name: string, values: Record<string, unknown>) => ({
      ...values,
      metadata_key: values.known_key,
    }),
  ),
}));

vi.mock("../../../src/runtime/RuntimeContext", () => ({
  useRuntime: () => ({ runtime: runtimeMock as unknown as RuntimeApi }),
}));

describe("DialogBridge", () => {
  it("runs dataset display callbacks through the runtime", async () => {
    render(<DialogBridge />);
    let result: Promise<unknown> | undefined;
    act(() => {
      result = runtimeMock.handler!("edit_dataset", {
        title: "Add metadata",
        schema: {
          type: "object",
          properties: {
            metadata_key: {
              type: "string",
              "x-guidata-kind": "string",
              "x-guidata-label": "Metadata key",
              "x-guidata-name": "metadata_key",
            },
            known_key: {
              type: "string",
              enum: ["", "gain"],
              "x-guidata-choices": [
                { value: "", label: "Select a key..." },
                { value: "gain", label: "gain — e.g. 2" },
              ],
              "x-guidata-kind": "choice",
              "x-guidata-label": "Known keys",
              "x-guidata-name": "known_key",
              "x-guidata-has-callback": true,
            },
          },
          "x-guidata-property-order": ["metadata_key", "known_key"],
        },
        values: { metadata_key: "custom_key", known_key: "" },
      });
    });

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "gain" } });

    await waitFor(() => {
      expect(runtimeMock.resolveBridgeCallbacks).toHaveBeenCalledWith(
        "known_key",
        expect.objectContaining({ known_key: "gain" }),
      );
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
        "gain",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await expect(result).resolves.toMatchObject({ metadata_key: "gain" });
  });
});
