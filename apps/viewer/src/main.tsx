import React from "react";
import ReactDOM from "react-dom/client";
import type { CardViewPayload, GraphViewPayload } from "@persona360/contracts";
import { App, type BootPayload } from "./App";
import "./styles.css";

declare global {
  interface Window {
    __PERSONA360_BOOT__?: {
      mode: "graph" | "card";
      payload: GraphViewPayload | CardViewPayload;
    };
  }
}

const boot = window.__PERSONA360_BOOT__ as BootPayload | undefined;

if (!boot) {
  throw new Error("persona360 viewer boot payload is missing.");
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App boot={boot} />
  </React.StrictMode>
);

