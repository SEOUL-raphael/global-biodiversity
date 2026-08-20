import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import mcpRouter from "./routes/mcp";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(mcpRouter);

// MCP (Model Context Protocol) endpoint — proxies directly to Cognee KG service
const COGNEE_BASE = process.env["COGNEE_SERVICE_URL"] ?? "http://localhost:5000";

async function cogneeProxy(path: string, method: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(`${COGNEE_BASE}${path}`, opts);
  let data: unknown;
  try { data = await resp.json(); } catch { data = {}; }
  return { status: resp.status, data };
}

app.get("/mcp", async (_req, res) => {
  try {
    const { status, data } = await cogneeProxy("/mcp", "GET");
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "service_unavailable" });
  }
});

app.post("/mcp", async (req, res) => {
  try {
    const { status, data } = await cogneeProxy("/mcp", "POST", req.body);
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "service_unavailable" });
  }
});

export default app;
