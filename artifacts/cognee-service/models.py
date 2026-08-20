"""
Cognee DataPoint subclasses for GBIF biodiversity knowledge graph.
These are stored in Cognee's Kuzu graph DB and LanceDB vector store.
"""
from typing import List, Optional
from pydantic import Field
from cognee.infrastructure.engine import DataPoint


class GBIFTaxon(DataPoint):
    """A GBIF taxonomic unit node in the Cognee knowledge graph."""

    taxon_id: str           # string taxon_key, used as identity field
    taxon_key: int
    canonical_name: str
    scientific_name: str
    rank: str
    kingdom: Optional[str] = None
    phylum: Optional[str] = None
    class_name: Optional[str] = None   # avoid Python keyword 'class'
    order: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    vernacular_name: Optional[str] = None
    iucn_status: Optional[str] = None
    geographic_range: List[str] = Field(default_factory=list)  # localities/regions from GBIF distributions
    num_occurrences: int = 0
    description: str = ""              # embeddable field for semantic search

    metadata: dict = {
        "index_fields": ["description"],
        "identity_fields": ["taxon_id"],
    }


class TaxonomicRankNode(DataPoint):
    """
    A node representing a taxonomic rank value (kingdom, phylum, class,
    order, family, or genus) in the Cognee knowledge graph.
    """

    rank_id: str     # e.g. "kingdom:Animalia"
    rank: str        # e.g. "kingdom"
    name: str        # e.g. "Animalia"
    description: str = ""

    metadata: dict = {
        "index_fields": ["description"],
        "identity_fields": ["rank_id"],
    }
