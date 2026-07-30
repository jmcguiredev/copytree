import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Dark-mode-first baseline (PLAN.md §2). Settings will later drive this from
// the stored Color Scheme value.
document.documentElement.dataset.theme = "dark";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
