import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "../../../src/utils/theme";

describe("host theme", () => {
  afterEach(() => {
    window.localStorage.removeItem("datalab-web:theme");
    document.documentElement.removeAttribute("data-theme");
  });

  it("updates the app without replacing the stored preference", () => {
    window.localStorage.setItem("datalab-web:theme", "light");
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme).toBe("light");

    act(() => result.current.setHostTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("datalab-web:theme")).toBe("light");

    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(window.localStorage.getItem("datalab-web:theme")).toBe("light");
  });
});
