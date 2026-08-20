import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { configureApiClient } from "./lib/api-origin";

configureApiClient();
createRoot(document.getElementById("root")!).render(<App />);
