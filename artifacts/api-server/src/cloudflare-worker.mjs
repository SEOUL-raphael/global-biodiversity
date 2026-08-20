const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function isApiPath(pathname) {
  return pathname === "/mcp" || pathname === "/api" || pathname.startsWith("/api/");
}

function corsOrigin(request, env) {
  const origin = request.headers.get("Origin");
  const configuredOrigins = (env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configuredOrigins.includes("*")) return "*";
  return origin && configuredOrigins.includes(origin) ? origin : null;
}

function applyCors(headers, request, env) {
  const allowedOrigin = corsOrigin(request, env);
  if (!allowedOrigin) return false;

  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-User-Api-Key, X-User-Api-Provider",
  );
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST");
  headers.set("Access-Control-Max-Age", "86400");
  if (allowedOrigin !== "*") headers.append("Vary", "Origin");
  return true;
}

function jsonError(status, message, request, env) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  applyCors(headers, request, env);
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function forwardHeaders(source) {
  const headers = new Headers(source);
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  headers.delete("Host");
  return headers;
}

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);

    if (!isApiPath(incomingUrl.pathname)) {
      return jsonError(404, "not_found", request, env);
    }

    if (incomingUrl.pathname.startsWith("/api/admin/")) {
      return jsonError(404, "not_found", request, env);
    }

    if (request.method === "OPTIONS") {
      const headers = new Headers();
      if (!applyCors(headers, request, env)) {
        return jsonError(403, "origin_not_allowed", request, env);
      }
      return new Response(null, { status: 204, headers });
    }

    if (!env.LEGACY_API_ORIGIN) {
      return jsonError(503, "upstream_not_configured", request, env);
    }

    let upstreamUrl;
    try {
      upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, env.LEGACY_API_ORIGIN);
    } catch {
      return jsonError(500, "invalid_upstream_configuration", request, env);
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: forwardHeaders(request.headers),
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        redirect: "manual",
      });

      const headers = forwardHeaders(upstream.headers);
      applyCors(headers, request, env);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch {
      return jsonError(502, "upstream_unavailable", request, env);
    }
  },
};