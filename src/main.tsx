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

createRoot(container).render(
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
