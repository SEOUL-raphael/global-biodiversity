"""
MCP (Model Context Protocol) server for Cognee GBIF KG.
Implements JSON-RPC 2.0 over HTTP at /mcp.
Tools: search_species, get_relationships, find_hotspots.
Search is backed by Cognee's LanceDB vector engine.
"""
import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

mcp_router = APIRouter()

MCP_SERVER_INFO = {
    "name": "cognee-gbif-kg",
    "version": "1.0.0",
    "protocolVersion": "2024-11-05",
}

TOOLS = [
    {
        "name": "search_species",
        "description": (
            "Search for species in the GBIF knowledge graph by name, "
            "kingdom, IUCN status or any taxonomic keyword. "
            "Results are ranked by semantic similarity using Cognee's vector search."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Species name or keyword to search for",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (default 10)",
                    "default": 10,
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_relationships",
        "description": (
            "Get the knowledge graph context for a specific taxon by its GBIF taxon key, "
            "including its taxonomic hierarchy (kingdom → phylum → class → order → family → genus)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "taxon_key": {
                    "type": "integer",
                    "description": "GBIF taxon key",
                },
            },
            "required": ["taxon_key"],
        },
    },
    {
        "name": "find_hotspots",
        "description": (
            "Find taxa with a given IUCN conservation status in the knowledge graph "
            "and identify the geographic regions where they occur. Returns species "
            "filtered by IUCN threat category, plus a ranked list of top regions by "
            "number of matching species (a biodiversity hotspot view)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "iucn_status": {
                    "type": "string",
                    "description": "IUCN status code (CR, EN, VU, NT, LC, EX, EW, DD). "
                    "If omitted, returns all threatened species.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of taxa to return",
                    "default": 10,
                },
            },
            "required": [],
        },
    },
]


async def _handle_tool_call(name: str, args: Dict) -> Dict:
    from main import loader_instance, _cognee_search

    if name == "search_species":
        query = args.get("query", "")
        limit = int(args.get("limit", 10))
        results = await _cognee_search(query, limit=limit)
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(results, ensure_ascii=False, indent=2),
                }
            ]
        }

    elif name == "get_relationships":
        taxon_key = int(args.get("taxon_key", 0))
        if loader_instance is None:
            return {
                "content": [{"type": "text", "text": "KG not ready yet"}],
                "isError": True,
            }
        context = loader_instance.get_species_context(taxon_key)
        if context is None:
            return {
                "content": [
                    {"type": "text", "text": f"Taxon {taxon_key} not found in Cognee KG"}
                ],
                "isError": True,
            }
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(context, ensure_ascii=False, indent=2),
                }
            ]
        }

    elif name == "find_hotspots":
        iucn_filter = args.get("iucn_status")
        limit = int(args.get("limit", 10))
        threatened = {"CR", "EN", "VU", "EW", "EX"}

        if loader_instance is None:
            return {
                "content": [{"type": "text", "text": "KG not ready yet"}],
                "isError": True,
            }

        all_matches = []
        for key, taxon in loader_instance.taxa_by_key.items():
            status = taxon.iucn_status
            if not status:
                continue
            if iucn_filter:
                if status != iucn_filter:
                    continue
            else:
                if status not in threatened:
                    continue
            all_matches.append(
                {
                    "taxonKey": taxon.taxon_key,
                    "canonicalName": taxon.canonical_name,
                    "iucnStatus": status,
                    "kingdom": taxon.kingdom,
                    "phylum": taxon.phylum,
                    "geographicRange": list(getattr(taxon, "geographic_range", []) or []),
                    "numOccurrences": taxon.num_occurrences,
                }
            )

        matches = all_matches[:limit]

        if not all_matches:
            query = f"IUCN {iucn_filter or 'endangered threatened'} species"
            search_results = await _cognee_search(query, limit=limit)
            matches = [
                {
                    "taxonKey": r.get("properties", {}).get("taxonKey"),
                    "canonicalName": r.get("label"),
                    "iucnStatus": r.get("properties", {}).get("iucnStatus"),
                    "kingdom": r.get("properties", {}).get("kingdom"),
                    "geographicRange": r.get("properties", {}).get("geographicRange", []),
                    "score": r.get("score", 0),
                }
                for r in search_results
                if r.get("nodeType") == "taxon"
            ]

        region_counts: Dict[str, int] = {}
        for m in all_matches:
            for region in m.get("geographicRange", []) or []:
                region_counts[region] = region_counts.get(region, 0) + 1
        top_regions = sorted(region_counts.items(), key=lambda x: -x[1])[:10]

        status_counts: Dict[str, int] = {}
        for m in all_matches:
            s = m.get("iucnStatus")
            if s:
                status_counts[s] = status_counts.get(s, 0) + 1

        payload = {
            "iucnStatusFilter": iucn_filter,
            "totalSpecies": len(all_matches),
            "returnedSpecies": len(matches),
            "iucnStatusCounts": status_counts,
            "topRegions": [{"region": r, "speciesCount": c} for r, c in top_regions],
            "species": matches,
        }

        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(payload, ensure_ascii=False, indent=2),
                }
            ]
        }

    raise ValueError(f"Unknown tool: {name}")


@mcp_router.get("/mcp")
async def mcp_get():
    return JSONResponse(
        {
            "server": MCP_SERVER_INFO,
            "tools": TOOLS,
            "capabilities": {"tools": {"listChanged": False}},
        }
    )


@mcp_router.post("/mcp")
async def mcp_post(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": None},
            status_code=400,
        )

    rpc_id = body.get("id")
    method = body.get("method", "")
    params = body.get("params", {})

    if method == "initialize":
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {
                    "protocolVersion": MCP_SERVER_INFO["protocolVersion"],
                    "serverInfo": MCP_SERVER_INFO,
                    "capabilities": {"tools": {"listChanged": False}},
                },
            }
        )

    if method == "tools/list":
        return JSONResponse(
            {"jsonrpc": "2.0", "id": rpc_id, "result": {"tools": TOOLS}}
        )

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        try:
            result = await _handle_tool_call(tool_name, tool_args)
            return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "result": result})
        except ValueError as e:
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {"code": -32601, "message": str(e)},
                }
            )
        except Exception as e:
            logger.error("Tool call error: %s", e, exc_info=True)
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {"code": -32603, "message": str(e)},
                }
            )

    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    )
