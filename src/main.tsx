import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./components/ConfirmDialog";
import { ProgressProvider } from "./components/ProgressDialog";
import { RuntimeProvider } from "./runtime/RuntimeContext";
import { WorkspaceProvider } from "./runtime/WorkspaceContext";
import { installConsoleCapture } from "./utils/consoleLog";
import { initThemeEarly, ThemeProvider } from "./utils/theme";
import "./styles.css";

installConsoleCapture();
initThemeEarly();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <RuntimeProvider>
        <WorkspaceProvider>
          <DialogProvider>
            <ProgressProvider>
              <App />
            </ProgressProvider>
          </DialogProvider>
        </WorkspaceProvider>
      </RuntimeProvider>
    </ThemeProvider>
  </StrictMode>,
);
