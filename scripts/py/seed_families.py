#!/usr/bin/env python3
"""
seed_families.py
Remaining animal/plant/fungi families → gbif_taxa
"""
import os, sys, time, json
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import HTTPError
import psycopg2
from psycopg2.extras import execute_values

DB_URL = os.environ["DATABASE_URL"]
GBIF_BASE = "https://api.gbif.org/v1"
RATE_MS = 130

FAMILIES = [
    # Mammals (Muridae/Cervidae/Bovidae already loaded)
    ("Rhinocerotidae",   9415),
    ("Suidae",           5302),
    ("Equidae",          5479),
    ("Otariidae",        5309),
    ("Phocidae",         5310),
    ("Pteropodidae",     9367),
    ("Vespertilionidae", 9368),
    ("Lemuridae",        5485),
    ("Callitrichidae",   9620),
    ("Cercopithecidae",  9622),
    ("Delphinidae",      5314),
    ("Balaenopteridae",  5313),
    # Birds
    ("Falconidae",       5240),
    ("Psittacidae",      9340),
    ("Strigidae",        9348),
    ("Ardeidae",         3685),
    ("Anatidae",         2986),
    ("Corvidae",         5235),
    ("Spheniscidae",     5284),
    ("Gruidae",          9313),
    ("Columbidae",       5233),
    ("Trochilidae",      5289),
    ("Picidae",          9333),
    # Reptiles
    ("Crocodylidae",     5685),
    ("Viperidae",        5024),
    ("Colubridae",       6172),
    ("Gekkonidae",       5666),
    ("Cheloniidae",      9413),
    ("Testudinidae",     9618),
    # Amphibians
    ("Ranidae",          6746),
    ("Bufonidae",        6727),
    ("Hylidae",          6735),
    ("Salamandridae",    6750),
    # Fish
    ("Scombridae",       8596),
    ("Cichlidae",        8522),
    ("Carcharhinidae",   2211),
    # Fungi
    ("Amanitaceae",      4171),
    ("Boletaceae",       8789),
    ("Polyporaceae",     3286),
    # Extra plants
    ("Lamiaceae",        2497),
    ("Apiaceae",         6720),
    ("Solanaceae",       7717),
    ("Pinaceae",         3925),
    ("Cactaceae",        2519),
    ("Euphorbiaceae",    4691),
    ("Ranunculaceae",    2410),
    ("Liliaceae",        7699),
    ("Moraceae",         6640),
]

_last_req = 0.0


def gbif_get(path: str, params: dict) -> dict:
    global _last_req
    wait = RATE_MS / 1000.0 - (time.time() - _last_req)
    if wait > 0:
        time.sleep(wait)
    qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    url = f"{GBIF_BASE}{path}?{qs}"
    req = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(req, timeout=30) as r:
            _last_req = time.time()
            return json.loads(r.read())
    except HTTPError as e:
        _last_req = time.time()
        if e.code in (400, 404):
            return {"results": [], "endOfRecords": True}
        raise RuntimeError(f"HTTP {e.code} {url}") from e


def make_row(t: dict) -> tuple:
    iucn = t.get("iucnRedListCategory") or (
        t.get("threatStatuses", [None])[0] if t.get("threatStatuses") else None
    )
    return (
        t["key"],
        t.get("parentKey"),
        t.get("rank", "UNRANKED"),
        t.get("kingdom"),
        t.get("phylum"),
        t.get("class"),
        t.get("order"),
        t.get("family"),
        t.get("genus"),
        t.get("species"),
        t.get("scientificName", ""),
        t.get("canonicalName"),
        t.get("vernacularName"),
        iucn,
        t.get("numOccurrences", 0),
        str(t.get("extinct")) if t.get("extinct") is not None else None,
        datetime.now(),
    )


INSERT_SQL = """
    INSERT INTO gbif_taxa
      (taxon_key, parent_key, rank, kingdom, phylum, class, "order", family,
       genus, species, scientific_name, canonical_name, vernacular_name,
       iucn_status, num_occurrences, extinct, updated_at)
    VALUES %s
    ON CONFLICT (taxon_key) DO UPDATE SET
      parent_key = EXCLUDED.parent_key,
      kingdom = EXCLUDED.kingdom,
      phylum = EXCLUDED.phylum,
      class = EXCLUDED.class,
      "order" = EXCLUDED.order,
      family = EXCLUDED.family,
      genus = EXCLUDED.genus,
      iucn_status = EXCLUDED.iucn_status,
      num_occurrences = EXCLUDED.num_occurrences,
      extinct = EXCLUDED.extinct,
      updated_at = EXCLUDED.updated_at
"""


def seed_family(conn, name: str, key: int) -> int:
    cur = conn.cursor()
    total = 0
    offset = 0
    sys.stdout.write(f"  [{name}] ")
    sys.stdout.flush()

    while offset < 5000:
        try:
            data = gbif_get("/species/search", {
                "highertaxonKey": key,
                "rank": "SPECIES",
                "status": "ACCEPTED",
                "limit": 100,
                "offset": offset,
            })
        except Exception as e:
            sys.stderr.write(f"\n  Error {name} offset={offset}: {e}\n")
            time.sleep(2)
            if offset == 0:
                break
            continue

        rows = [make_row(t) for t in data.get("results", []) if "key" in t]
        if rows:
            execute_values(cur, INSERT_SQL, rows)
            conn.commit()
            total += len(rows)

        if data.get("endOfRecords") or not data.get("results"):
            break
        offset += 100

    sys.stdout.write(f"{total} species\n")
    sys.stdout.flush()
    cur.close()
    return total


def seed_fungi(conn) -> int:
    sys.stdout.write("\n[Fungi kingdom] Loading up to 10000 species...\n")
    sys.stdout.flush()
    cur = conn.cursor()
    total = 0
    offset = 0

    while offset < 10000:
        try:
            data = gbif_get("/species/search", {
                "highertaxonKey": 5,
                "rank": "SPECIES",
                "status": "ACCEPTED",
                "limit": 100,
                "offset": offset,
            })
        except Exception as e:
            sys.stderr.write(f"  Error Fungi offset={offset}: {e}\n")
            time.sleep(2)
            continue

        rows = [make_row(t) for t in data.get("results", []) if "key" in t]
        if rows:
            execute_values(cur, INSERT_SQL, rows)
            conn.commit()
            total += len(rows)

        if total % 1000 == 0 and total > 0:
            sys.stdout.write(f"  {total} Fungi...\n")
            sys.stdout.flush()

        if data.get("endOfRecords") or not data.get("results"):
            break
        offset += 100

    sys.stdout.write(f"  Done: {total} Fungi species\n")
    sys.stdout.flush()
    cur.close()
    return total


def main():
    conn = psycopg2.connect(DB_URL)
    print("=== Remaining Families Seeding (Python) ===\n")

    grand_total = 0
    for name, key in FAMILIES:
        grand_total += seed_family(conn, name, key)

    print(f"\nFamilies done: {grand_total} species")
    seed_fungi(conn)

    cur = conn.cursor()
    cur.execute("SELECT kingdom, count(*) FROM gbif_taxa GROUP BY kingdom ORDER BY count(*) DESC")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")
    cur.close()
    conn.close()
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
