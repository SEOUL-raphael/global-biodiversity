"""
Cognee KG Service — FastAPI application.
Uses the Cognee library (cognee.infrastructure.engine.DataPoint,
cognee.tasks.storage.add_data_points, LanceDB vector store,
Kuzu graph DB, FastEmbed embeddings) to build a GBIF biodiversity
knowledge graph exposed via REST + MCP endpoints.
"""
import os
import shutil
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Disable Cognee multi-user ACL and session caching for standalone mode
os.environ.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")
os.environ.setdefault("CACHING", "false")

import cognee
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cognee.infrastructure.databases.vector import get_vector_engine
from loader import GbifCogneeLoader
from mcp_server import mcp_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

COGNEE_SYSTEM_DIR = os.environ.get(
    "COGNEE_SYSTEM_DIR",
    str(Path(__file__).parent / ".cognee_data"),
)
INGESTION_MARKER = Path(COGNEE_SYSTEM_DIR) / ".ingestion_complete"
SNAPSHOT_PATH = Path(COGNEE_SYSTEM_DIR) / "warm_snapshot.json"

loader_instance: Optional[GbifCogneeLoader] = None
load_task: Optional[asyncio.Task] = None
warm_started: bool = False


def _ingestion_complete() -> bool:
    return INGESTION_MARKER.exists()


def _mark_ingestion_complete() -> None:
    INGESTION_MARKER.parent.mkdir(parents=True, exist_ok=True)
    INGESTION_MARKER.write_text("ok")


def _wipe_cognee_data() -> None:
    p = Path(COGNEE_SYSTEM_DIR)
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)


async def _run_full_ingest():
    assert loader_instance is not None
    await loader_instance.load_all()
    _mark_ingestion_complete()


def _new_loader() -> GbifCogneeLoader:
    return GbifCogneeLoader(snapshot_path=str(SNAPSHOT_PATH))


def _configure_cognee():
    """
    Configure Cognee for fully local operation:
      - FastEmbed (BAAI/bge-small-en-v1.5, 384-dim) for embeddings — no API key
      - LanceDB for vector storage — local file-based
      - Kuzu for graph storage — embedded graph DB
    """
    cognee.config.system_root_directory(COGNEE_SYSTEM_DIR)
    cognee.config.set_embedding_provider("fastembed")
    cognee.config.set_embedding_model("BAAI/bge-small-en-v1.5")
    cognee.config.set_embedding_dimensions(384)
    cognee.config.set_graph_database_provider("kuzu")
    cognee.config.set_vector_db_provider("lancedb")
    logger.info(
        "Cognee configured: fastembed + lancedb + kuzu @ %s", COGNEE_SYSTEM_DIR
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global loader_instance, load_task, warm_started
    _configure_cognee()
    loader_instance = _new_loader()
    if _ingestion_complete() and SNAPSHOT_PATH.exists():
        logger.info(
            "Cognee data + snapshot found at %s — warm starting (no DB/API fetch)",
            COGNEE_SYSTEM_DIR,
        )
        warm_started = True
        load_task = asyncio.create_task(loader_instance.warm_load())
    else:
        logger.info(
            "No persisted Cognee snapshot at %s — running full ingestion",
            COGNEE_SYSTEM_DIR,
        )
        warm_started = False
        load_task = asyncio.create_task(_run_full_ingest())
    yield
    if load_task and not load_task.done():
        load_task.cancel()


app = FastAPI(title="Cognee GBIF KG Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mcp_router)


@app.get("/status")
async def status():
    if loader_instance is None:
        return {"status": "initializing", "nodeCount": 0, "edgeCount": 0, "loaded": False}

    loading = load_task is not None and not load_task.done()
    load_error = None
    if load_task is not None and load_task.done():
        exc = load_task.exception()
        if exc:
            load_error = str(exc)

    stats = loader_instance.get_stats()
    return {
        "status": "loading" if loading else ("error" if load_error else "ready"),
        "nodeCount": stats["nodeCount"],
        "edgeCount": stats["edgeCount"],
        "nodesByType": {
            "taxon": stats["taxaLoaded"],
            "rank": stats["rankNodesLoaded"],
        },
        "taxaLoaded": stats["taxaLoaded"],
        "loaded": not loading,
        "loadError": load_error,
        "warmStarted": warm_started,
        "persistedDir": COGNEE_SYSTEM_DIR,
        "ingestionComplete": _ingestion_complete(),
        "backend": {
            "graph": "kuzu",
            "vector": "lancedb",
            "embeddings": "fastembed/BAAI/bge-small-en-v1.5",
        },
    }


@app.post("/reload")
async def reload(force: bool = Query(False, description="Wipe persisted Cognee data and re-ingest from scratch")):
    """
    Trigger a fresh ingestion. With force=true, wipes the persisted Kuzu/LanceDB
    stores so the next load rebuilds embeddings + graph from scratch. Without
    force, simply re-runs the ingestion pipeline (idempotent on identity_fields).
    """
    global load_task, loader_instance, warm_started
    if load_task is not None and not load_task.done():
        raise HTTPException(status_code=409, detail="A load is already in progress")

    if force:
        _wipe_cognee_data()
        _configure_cognee()

    loader_instance = _new_loader()
    warm_started = False
    load_task = asyncio.create_task(_run_full_ingest())
    return JSONResponse(
        {"status": "reload_started", "force": force, "persistedDir": COGNEE_SYSTEM_DIR}
    )


@app.get("/search")
async def search(q: str = Query(..., description="Species name or keyword to search for")):
    if loader_instance is None or (load_task is not None and not load_task.done() and loader_instance.taxa_loaded == 0):
        raise HTTPException(status_code=503, detail="Cognee KG still loading, please retry")

    results = await _cognee_search(q, limit=20)
    return {
        "query": q,
        "count": len(results),
        "results": results,
    }


@app.get("/graph/species/{taxon_key}")
async def graph_species(taxon_key: int):
    if loader_instance is None:
        raise HTTPException(status_code=503, detail="Cognee KG not initialized")

    context = loader_instance.get_species_context(taxon_key)
    if context is None:
        raise HTTPException(
            status_code=404,
            detail=f"Taxon {taxon_key} not found in Cognee knowledge graph",
        )
    return context


async def _cognee_search(query: str, limit: int = 20) -> list:
    """
    Semantic search using Cognee's LanceDB vector engine (FastEmbed embeddings).
    The vector store returns IndexSchema objects whose `id` equals the original
    DataPoint UUID, so we look up the full taxon/rank-node from the in-memory
    cache by UUID. LanceDB returns cosine distances — lower = better match.
    """
    vector_engine = get_vector_engine()
    results = []

    for collection, is_taxon in [
        ("GBIFTaxon_description", True),
        ("TaxonomicRankNode_description", False),
    ]:
        try:
            hits = await vector_engine.search(
                collection, query, limit=limit, include_payload=True
            )
            for hit in hits:
                payload = getattr(hit, "payload", {}) or {}
                # LanceDB returns cosine distance (lower = better); convert to similarity
                distance = float(getattr(hit, "score", 1.0) or 1.0)
                similarity = max(0.0, 1.0 - distance)

                hit_uuid = str(payload.get("id", ""))

                if is_taxon:
                    taxon = (
                        loader_instance.uuid_to_taxon.get(hit_uuid)
                        if loader_instance else None
                    )
                    if not taxon:
                        continue
                    results.append(
                        {
                            "externalId": f"TAXON:{taxon.taxon_key}",
                            "nodeType": "taxon",
                            "label": taxon.canonical_name,
                            "properties": {
                                "taxonKey": taxon.taxon_key,
                                "rank": taxon.rank,
                                "kingdom": taxon.kingdom,
                                "phylum": taxon.phylum,
                                "class": taxon.class_name,
                                "order": taxon.order,
                                "family": taxon.family,
                                "genus": taxon.genus,
                                "scientificName": taxon.scientific_name,
                                "canonicalName": taxon.canonical_name,
                                "vernacularName": taxon.vernacular_name,
                                "iucnStatus": taxon.iucn_status,
                                "numOccurrences": taxon.num_occurrences,
                            },
                            "relatedTo": [],
                            "score": similarity,
                        }
                    )
                else:
                    rank_node = (
                        loader_instance.uuid_to_rank_node.get(hit_uuid)
                        if loader_instance else None
                    )
                    if not rank_node:
                        continue
                    results.append(
                        {
                            "externalId": f"{rank_node.rank.upper()}:{rank_node.name}",
                            "nodeType": rank_node.rank,
                            "label": rank_node.name,
                            "properties": {
                                "rank": rank_node.rank,
                                "name": rank_node.name,
                            },
                            "relatedTo": [],
                            "score": similarity,
                        }
                    )
        except Exception as exc:
            logger.warning("Cognee vector search failed for %s: %s", collection, exc)

    # Sort by descending similarity (higher = better)
    results.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    # Deduplicate by externalId
    seen = set()
    deduped = []
    for r in results:
        eid = r["externalId"]
        if eid not in seen:
            seen.add(eid)
            deduped.append(r)
    return deduped[:limit]


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
