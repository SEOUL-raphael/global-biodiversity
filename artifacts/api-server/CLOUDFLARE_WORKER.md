# Cloudflare Worker API gateway

This Worker exposes only `/api/*` and `/mcp`, adds browser CORS handling, and
streams the upstream response unchanged. It is a safe transition layer while
the Node-only ingestion, local embedding, semantic search, and AI execution
are moved to Worker-compatible services.

## Required Worker variables

Configure these in Cloudflare's Worker settings before deployment:

- `LEGACY_API_ORIGIN`: the HTTPS origin of the current API service, without a
  trailing path. This is intentionally a Worker-side setting, not browser code.
- `ALLOWED_ORIGINS`: comma-separated browser origins permitted by CORS. Use the
  final GitHub Pages origin (for example, `https://account.github.io`).

The Worker never exposes database credentials or Supabase secrets to browsers.

## Deploy

From `artifacts/api-server`, authenticate Wrangler with the intended Cloudflare
account and deploy the checked-in `wrangler.toml`. Set the two variables above
in the Cloudflare dashboard or through the deployment environment before
serving traffic.

After deployment, add the Worker origin to the GitHub repository variable
`CLOUDFLARE_API_ORIGIN`; the Pages workflow passes it to the dashboard build as
`VITE_API_ORIGIN`.