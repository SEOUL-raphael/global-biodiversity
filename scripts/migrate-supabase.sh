#!/usr/bin/env bash
set -euo pipefail

# Copies the complete public GBIF schema and data to an EMPTY Supabase project.
# It never changes the source database and never clears a non-empty target.
#
# Required secrets:
# - MIGRATION_SOURCE_DATABASE_URL       read-only production PostgreSQL URL
#   (falls back to DATABASE_URL for development validation)
# - SUPABASE_TRANSACTION_POOLER_TEMPLATE (preferred) or
#   SUPABASE_TRANSACTION_POOLER_URI       Supabase Transaction pooler URI with
#                                         the literal [YOUR-PASSWORD] placeholder
# - SUPABASE_DB_PASSWORD_V2 (preferred) or SUPABASE_DB_PASSWORD
#                                         raw Supabase database password
#
# Commands:
#   pnpm --filter @workspace/scripts run migrate-supabase check
#   pnpm --filter @workspace/scripts run migrate-supabase migrate
#   pnpm --filter @workspace/scripts run migrate-supabase verify

MODE="${1:-check}"
case "$MODE" in
  check|migrate|verify) ;;
  *)
    echo "Usage: $0 {check|migrate|verify}" >&2
    exit 64
    ;;
esac

SOURCE_URL="${MIGRATION_SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
: "${SOURCE_URL:?MIGRATION_SOURCE_DATABASE_URL or DATABASE_URL must be available for the source database.}"
export SOURCE_URL
SUPABASE_PASSWORD="${SUPABASE_DB_PASSWORD_V2:-${SUPABASE_DB_PASSWORD:-}}"
: "${SUPABASE_PASSWORD:?SUPABASE_DB_PASSWORD_V2 or SUPABASE_DB_PASSWORD must be set.}"
export SUPABASE_PASSWORD

POOLER_TEMPLATE="${SUPABASE_TRANSACTION_POOLER_TEMPLATE:-${SUPABASE_TRANSACTION_POOLER_URI:-}}"
: "${POOLER_TEMPLATE:?SUPABASE_TRANSACTION_POOLER_TEMPLATE or SUPABASE_TRANSACTION_POOLER_URI must be set.}"
export POOLER_TEMPLATE

if [[ "$POOLER_TEMPLATE" != *"[YOUR-PASSWORD]"* ]]; then
  echo "The Supabase pooler URI must retain the literal [YOUR-PASSWORD] placeholder." >&2
  exit 65
fi

TARGET_URL="$(
  python3 - <<'PY'
import os
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

template = os.environ["POOLER_TEMPLATE"]
password = quote(os.environ["SUPABASE_PASSWORD"], safe="")
parsed = urlsplit(template.replace("[YOUR-PASSWORD]", password))
params = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
          if key.lower() != "pgbouncer"]
if not any(key.lower() == "sslmode" for key, _ in params):
    params.append(("sslmode", "require"))
print(urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(params), parsed.fragment)))
PY
)"
export TARGET_URL

cleanup() {
  [[ -n "${DUMP_FILE:-}" ]] && rm -f "$DUMP_FILE"
  [[ -n "${RESTORE_LIST:-}" ]] && rm -f "$RESTORE_LIST"
  unset TARGET_URL
}
trap cleanup EXIT

require_target_connection() {
  psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -Atc "SELECT 1" >/dev/null
}

table_counts() {
  local url="$1"
  psql "$url" -X -q -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
SELECT 'gbif_taxa', count(*) FROM public.gbif_taxa
UNION ALL SELECT 'gbif_occurrences', count(*) FROM public.gbif_occurrences
UNION ALL SELECT 'gbif_regions', count(*) FROM public.gbif_regions
UNION ALL SELECT 'gbif_sync_log', count(*) FROM public.gbif_sync_log
UNION ALL SELECT 'gbif_kg_nodes', count(*) FROM public.gbif_kg_nodes
UNION ALL SELECT 'gbif_kg_edges', count(*) FROM public.gbif_kg_edges
ORDER BY 1;
SQL
}

require_target_connection

if [[ "$MODE" == "check" ]]; then
  table_count="$(
    psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -Atc \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
  )"
  existing_gbif_tables="$(
    psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -Atc \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'gbif_%'"
  )"
  database_size="$(
    psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -Atc \
      "SELECT pg_size_pretty(pg_database_size(current_database()))"
  )"
  echo "Supabase connection verified. Public tables: $table_count; GBIF tables: $existing_gbif_tables; database size: $database_size"
  exit 0
fi

if [[ "$MODE" == "migrate" ]]; then
  existing_gbif_tables="$(
    psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -Atc \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'gbif_%'"
  )"
  if [[ "$existing_gbif_tables" != "0" ]]; then
    echo "Refusing to migrate: target already has $existing_gbif_tables GBIF tables. No data was changed." >&2
    exit 66
  fi

  DUMP_FILE="$(mktemp "${TMPDIR:-/tmp}/gbif-supabase-migration.XXXXXX.dump")"
  RESTORE_LIST="$(mktemp "${TMPDIR:-/tmp}/gbif-supabase-restore-list.XXXXXX.txt")"
  echo "Creating a read-only source dump..."
  pg_dump "$SOURCE_URL" \
    --format=custom \
    --schema=public \
    --no-owner \
    --no-privileges \
    --file="$DUMP_FILE"

  # Supabase creates public before application data is imported.  Keep that
  # schema and restore only its objects, avoiding a harmless-but-fatal
  # duplicate CREATE SCHEMA public command.
  pg_restore --list "$DUMP_FILE" \
    | sed '/ SCHEMA - public /d' > "$RESTORE_LIST"

  echo "Restoring GBIF schema and data into the empty Supabase target..."
  pg_restore \
    --dbname="$TARGET_URL" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    --use-list="$RESTORE_LIST" \
    "$DUMP_FILE"
  echo "Restore completed. Run this script with 'verify' before switching DATABASE_PROVIDER."
  exit 0
fi

source_counts="$(table_counts "$SOURCE_URL")"
target_counts="$(table_counts "$TARGET_URL")"

if [[ "$source_counts" != "$target_counts" ]]; then
  echo "Verification failed: source and target row counts differ." >&2
  echo "Source:" >&2
  echo "$source_counts" >&2
  echo "Target:" >&2
  echo "$target_counts" >&2
  exit 67
fi

echo "Verification passed. Source and Supabase target row counts match:"
echo "$target_counts"