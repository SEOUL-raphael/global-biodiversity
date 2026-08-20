#!/usr/bin/env python3
"""
seed_occurrences.py
Animalia 전 종 + Plantae 샘플 발생 데이터 대량 적재
- 종당 최대 200건 (2 pages × 100)
- 체크포인트: /tmp/occ_checkpoint.txt
"""
import os, sys, time, json
from urllib.request import urlopen, Request
from urllib.error import HTTPError
import psycopg2
from psycopg2.extras import execute_values

DB_URL = os.environ["DATABASE_URL"]
GBIF_BASE = "https://api.gbif.org/v1"
RATE_MS = 130
CHECKPOINT_FILE = "/tmp/occ_checkpoint.txt"
PAGES_PER_SPECIES = 2

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


def load_checkpoint() -> int:
    try:
        with open(CHECKPOINT_FILE) as f:
            return int(f.read().strip())
    except Exception:
        return 0


def save_checkpoint(taxon_key: int):
    try:
        with open(CHECKPOINT_FILE, "w") as f:
            f.write(str(taxon_key))
    except Exception:
        pass


OCC_INSERT = """
    INSERT INTO gbif_occurrences
      (gbif_key, taxon_key, country_code, decimal_latitude, decimal_longitude,
       year, month, dataset_key, basis_of_record)
    VALUES %s
    ON CONFLICT (gbif_key) DO NOTHING
"""

REGION_UPSERT = """
    INSERT INTO gbif_regions (country_code, country_name, occurrence_count, species_count, last_synced)
    VALUES (%s, %s, %s, %s, NOW())
    ON CONFLICT (country_code) DO UPDATE SET
      occurrence_count = gbif_regions.occurrence_count + EXCLUDED.occurrence_count,
      species_count    = gbif_regions.species_count    + EXCLUDED.species_count,
      last_synced      = NOW()
"""


def seed_species(conn, taxon_key: int) -> int:
    cur = conn.cursor()
    total = 0
    country_occ: dict[str, int] = {}

    for page_idx in range(PAGES_PER_SPECIES):
        try:
            data = gbif_get("/occurrence/search", {
                "taxonKey": taxon_key,
                "hasCoordinate": "true",
                "limit": 100,
                "offset": page_idx * 100,
            })
        except Exception as e:
            sys.stderr.write(f"  Error taxon {taxon_key} page {page_idx}: {e}\n")
            break

        rows = []
        for occ in data.get("results", []):
            if not occ.get("key") or not occ.get("countryCode"):
                continue
            cc = occ["countryCode"][:2]
            rows.append((
                occ["key"],
                occ.get("taxonKey", taxon_key),
                cc,
                occ.get("decimalLatitude"),
                occ.get("decimalLongitude"),
                occ.get("year"),
                occ.get("month"),
                occ.get("datasetKey"),
                occ.get("basisOfRecord"),
            ))
            country_occ[cc] = country_occ.get(cc, 0) + 1
            total += 1

        if rows:
            execute_values(cur, OCC_INSERT, rows)
            conn.commit()

        if data.get("endOfRecords") or not data.get("results"):
            break

    # 지역 통계 업데이트 (발생 있는 경우만)
    for cc, n in country_occ.items():
        cur.execute(REGION_UPSERT, (cc, cc, n, 1))
    if country_occ:
        conn.commit()

    cur.close()
    return total


def process_batch(conn, species_list: list, label: str):
    processed = 0
    total_occ = 0
    errors = 0

    for taxon_key, canonical_name in species_list:
        try:
            n = seed_species(conn, taxon_key)
            total_occ += n
            processed += 1
            save_checkpoint(taxon_key)

            if processed % 300 == 0 or processed == len(species_list):
                sys.stdout.write(
                    f"  [{label}] {processed}/{len(species_list)} species, "
                    f"{total_occ} occ, err:{errors}\n"
                )
                sys.stdout.flush()
        except Exception as e:
            errors += 1
            sys.stderr.write(f"  Fatal {taxon_key}: {e}\n")
            if errors > 200:
                sys.stderr.write("  Too many errors, stopping batch\n")
                break
            time.sleep(1)

    print(f"  [{label}] Finished: {processed} species, {total_occ} occ, {errors} errors")
    return total_occ


def main():
    conn = psycopg2.connect(DB_URL)
    print("=== GBIF Occurrence Seeding (Python) ===\n")

    last_key = load_checkpoint()
    if last_key > 0:
        print(f"Resuming from taxon_key > {last_key}\n")

    # Animalia 전 종
    cur = conn.cursor()
    cur.execute("""
        SELECT taxon_key, canonical_name FROM gbif_taxa
        WHERE kingdom = 'Animalia' AND taxon_key > %s
        ORDER BY taxon_key
    """, (last_key,))
    animalia = cur.fetchall()
    cur.close()
    print(f"Animalia: {len(animalia)} species\n")
    process_batch(conn, animalia, "Animalia")

    # Plantae 샘플 2000종
    cur = conn.cursor()
    cur.execute("""
        SELECT taxon_key, canonical_name FROM gbif_taxa
        WHERE kingdom = 'Plantae'
        ORDER BY taxon_key
        LIMIT 2000
    """)
    plantae = cur.fetchall()
    cur.close()
    print(f"\nPlantae: {len(plantae)} species\n")
    process_batch(conn, plantae, "Plantae")

    # 최종 통계
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM gbif_occurrences")
    total_occ = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM gbif_regions")
    regions = cur.fetchone()[0]
    cur.close()
    conn.close()

    print(f"\n=== Done: total_occ={total_occ}, regions={regions} ===")


if __name__ == "__main__":
    main()
