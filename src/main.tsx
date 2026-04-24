import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RuntimeProvider } from "./runtime/RuntimeContext";
import { installConsoleCapture } from "./utils/consoleLog";
import { initThemeEarly } from "./utils/theme";
import "./styles.css";

installConsoleCapture();
initThemeEarly();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

createRoot(container).render(
  <StrictMode>
    <RuntimeProvider>
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
