import { Router, type IRouter } from "express";

const router: IRouter = Router();

const COGNEE_BASE = process.env.COGNEE_SERVICE_URL ?? "http://localhost:5000";

async function proxyRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${COGNEE_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const resp = await fetch(url, options);
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    data = { error: "invalid_response", message: "Cognee service returned non-JSON response" };
  }
  return { status: resp.status, data };
}

router.get("/cognee/status", async (req, res) => {
  try {
    const { status, data } = await proxyRequest("/status", "GET");
    res.status(status).json(data);
  } catch (err) {
    req.log.error({ err }, "Cognee proxy error: /status");
    res.status(503).json({ error: "service_unavailable", message: "Cognee service is not reachable" });
  }
});

router.get("/cognee/search", async (req, res) => {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "bad_request", message: "q parameter is required" });
    return;
  }
  try {
    const { status, data } = await proxyRequest(`/search?q=${encodeURIComponent(q)}`, "GET");
    res.status(status).json(data);
  } catch (err) {
    req.log.error({ err }, "Cognee proxy error: /search");
    res.status(503).json({ error: "service_unavailable", message: "Cognee service is not reachable" });
  }
});

router.get("/cognee/graph/species/:taxonKey", async (req, res) => {
  const taxonKey = parseInt(req.params.taxonKey, 10);
  if (isNaN(taxonKey) || taxonKey <= 0) {
    res.status(400).json({ error: "bad_request", message: "Invalid taxon key" });
    return;
  }
  try {
    const { status, data } = await proxyRequest(`/graph/species/${taxonKey}`, "GET");
    res.status(status).json(data);
  } catch (err) {
    req.log.error({ err }, "Cognee proxy error: /graph/species");
    res.status(503).json({ error: "service_unavailable", message: "Cognee service is not reachable" });
  }
});

router.get("/cognee/mcp", async (req, res) => {
  try {
    const { status, data } = await proxyRequest("/mcp", "GET");
    res.status(status).json(data);
  } catch (err) {
    req.log.error({ err }, "Cognee proxy error: /mcp GET");
    res.status(503).json({ error: "service_unavailable", message: "Cognee service is not reachable" });
  }
});

router.post("/cognee/mcp", async (req, res) => {
  try {
    const { status, data } = await proxyRequest("/mcp", "POST", req.body);
    res.status(status).json(data);
  } catch (err) {
    req.log.error({ err }, "Cognee proxy error: /mcp POST");
    res.status(503).json({ error: "service_unavailable", message: "Cognee service is not reachable" });
  }
});

export default router;
