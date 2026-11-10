import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/700.css";
import { Signage } from "./Signage";
import { CloudGate } from "../../shared/CloudSetup";
import "./styles.css";
import "./odpt.css";
import "./service-info.css";
import "../../shared/theme.css";
document.documentElement.classList.toggle(
  "windows",
  navigator.userAgent.includes("Windows"),
);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CloudGate product="Signage"><Signage /></CloudGate>
  </StrictMode>,
);
