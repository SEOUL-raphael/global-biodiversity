import json
from typing import Any
import db

MCP_PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "search_species",
        "description": "Search for species in the GBIF biodiversity database by name. Returns scientific name, IUCN status, and occurrence count.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Species name or partial name to search (e.g. 'Panthera', 'Orchis')"},
                "limit": {"type": "integer", "description": "Maximum number of results to return (default: 10, max: 50)", "default": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_species_context",
        "description": "Get the knowledge graph context for a species — neighbouring nodes (regions, threats, relatives) within 1-2 hops.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "taxon_key": {"type": "integer", "description": "GBIF taxon key (integer ID)"},
                "hops": {"type": "integer", "description": "Graph traversal depth: 1 or 2 (default: 2)", "default": 2},
            },
            "required": ["taxon_key"],
        },
    },
    {
        "name": "find_endangered_hotspots",
        "description": "Find geographic regions with the highest number of endangered, critically endangered, or vulnerable species.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Maximum number of regions to return (default: 10)", "default": 10},
            },
        },
    },
    {
        "name": "get_cooccurrence_clusters",
        "description": "Find pairs of species that co-occur in the same regions and time periods (Jaccard similarity score).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "description": "ISO 2-letter country code to filter (e.g. 'US', 'KR', 'DE')"},
                "min_jaccard": {"type": "number", "description": "Minimum Jaccard similarity threshold 0–1 (default: 0.1)", "default": 0.1},
                "limit": {"type": "integer", "description": "Maximum number of species pairs to return (default: 20)", "default": 20},
            },
        },
    },
    {
        "name": "get_taxonomy_gaps",
        "description": "Find taxonomic families and orders with low observation coverage (high species count but few recorded occurrences).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Maximum number of results (default: 20)", "default": 20},
            },
        },
    },
]


def handle_mcp_request(body: dict) -> dict:
    req_id = body.get("id")
    method = body.get("method", "")
    params = body.get("params", {})

    try:
        result = _dispatch(method, params)
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except ValueError as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": str(e)},
        }
    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32603, "message": f"Internal error: {e}"},
        }


def _dispatch(method: str, params: dict) -> Any:
    if method == "initialize":
        return {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "gbif-kg-mcp", "version": "1.0.0"},
        }
    if method in ("notifications/initialized", "ping"):
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments", {})
        return _call_tool(name, args)
    raise ValueError(f"Method not found: {method}")


def _call_tool(name: str, args: dict) -> dict:
    if name == "search_species":
        limit = min(int(args.get("limit", 10)), 50)
        results = db.search_taxa(args.get("query", ""), limit)
        return {"content": [{"type": "text", "text": json.dumps(results, default=str)}]}

    if name == "get_species_context":
        taxon_key = int(args.get("taxon_key", 0))
        hops = max(1, min(int(args.get("hops", 2)), 2))
        context = db.get_kg_context(taxon_key, hops)
        return {"content": [{"type": "text", "text": json.dumps(context, default=str)}]}

    if name == "find_endangered_hotspots":
        limit = min(int(args.get("limit", 10)), 50)
        hotspots = db.get_endangered_hotspots(limit)
        return {"content": [{"type": "text", "text": json.dumps(hotspots, default=str)}]}

    if name == "get_cooccurrence_clusters":
        region = args.get("region")
        min_j = float(args.get("min_jaccard", 0.1))
        limit = min(int(args.get("limit", 20)), 100)
        clusters = db.get_cooccurrence(region, min_j, limit)
        return {"content": [{"type": "text", "text": json.dumps(clusters, default=str)}]}

    if name == "get_taxonomy_gaps":
        limit = min(int(args.get("limit", 20)), 100)
        gaps = db.get_taxonomy_gaps(limit)
        return {"content": [{"type": "text", "text": json.dumps(gaps, default=str)}]}

    raise ValueError(f"Unknown tool: {name}")
