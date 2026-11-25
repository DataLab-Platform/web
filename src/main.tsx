import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./components/ConfirmDialog";
import { ProgressProvider } from "./components/ProgressDialog";
import { ToastProvider } from "./components/Toast";
import { I18nProvider, initI18nEarly } from "./i18n";
import { RuntimeProvider } from "./runtime/RuntimeContext";
import { WorkspaceProvider } from "./runtime/WorkspaceContext";
import { preloadPrimaryPlots } from "./components/lazyPlotComponents";
import { installConsoleCapture } from "./utils/consoleLog";
import { initThemeEarly, ThemeProvider } from "./utils/theme";
import "./styles.css";

installConsoleCapture();
initThemeEarly();
initI18nEarly();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

const root = createRoot(container);
if (
  import.meta.env.VITE_WASM64_DEMO === "1" &&
  new URLSearchParams(location.search).get("reset-demo-storage") === "1"
) {
  // Navigation releases the running kernel and any open database handles.
  // Opening this URL alone never deletes data: confirmation is required.
  void import("./components/DemoProfileReset").then(({ DemoProfileReset }) =>
    root.render(<DemoProfileReset />),
  );
} else {
  root.render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <RuntimeProvider>
            <WorkspaceProvider>
              <DialogProvider>
                <ProgressProvider>
                  <ToastProvider>
                    <App />
                  </ToastProvider>
                </ProgressProvider>
              </DialogProvider>
            </WorkspaceProvider>
          </RuntimeProvider>
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  );

  requestAnimationFrame(() => {
    void preloadPrimaryPlots().catch((error: unknown) => {
      console.warn("[plotting] background preload failed", error);
    });
  });
}
