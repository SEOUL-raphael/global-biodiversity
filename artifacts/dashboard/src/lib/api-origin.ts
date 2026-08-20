import { setBaseUrl } from "@workspace/api-client-react";

const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim();

export const apiOrigin = configuredOrigin
  ? configuredOrigin.replace(/\/+$/, "")
  : null;

/**
 * Builds an API or MCP URL that works in both the Replit preview (same origin)
 * and the GitHub Pages deployment (separate Cloudflare Worker origin).
 */
export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return apiOrigin ? `${apiOrigin}${normalizedPath}` : normalizedPath;
}

export function configureApiClient(): void {
  setBaseUrl(apiOrigin);
}