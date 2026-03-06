import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SigimaProvider } from "./sigima/SigimaContext";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

createRoot(container).render(
  <StrictMode>
    <SigimaProvider>
      <App />
    </SigimaProvider>
  </StrictMode>,
);
