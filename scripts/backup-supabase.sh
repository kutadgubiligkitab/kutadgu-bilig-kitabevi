#!/usr/bin/env bash
# Export-only logical backup. Never restores, never DELETE/UPDATE.
# Secrets stay in the environment. Do not commit backups/local/.
#
#   export SUPABASE_DB_URL='postgresql://...'   # Dashboard → Connect
#   ./scripts/backup-supabase.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${KUTADGU_BACKUP_DIR:-$ROOT/backups/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_DIR/$STAMP"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Refusing: SUPABASE_DB_URL is not set. Copy the URI from Supabase Dashboard → Connect." >&2
  echo "Do not put the URI in git." >&2
  exit 1
fi

mkdir -p "$DEST"

echo "Writing dumps under $DEST"

if command -v supabase >/dev/null 2>&1; then
  supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DEST/schema.sql"
  supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DEST/data.sql" --use-copy --data-only
elif command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$SUPABASE_DB_URL" --schema-only -f "$DEST/schema.sql"
  pg_dump "$SUPABASE_DB_URL" --data-only --format=plain -f "$DEST/data.sql"
else
  echo "Install Supabase CLI (preferred) or PostgreSQL pg_dump." >&2
  exit 1
fi

if command -v pg_dump >/dev/null 2>&1; then
  for table in books admin_users profiles member_favorites member_cart_items orders analytics_events; do
    pg_dump "$SUPABASE_DB_URL" --data-only --table="public.$table" -f "$DEST/${table}.sql"
  done
fi

{
  echo "created_utc=$STAMP"
  echo "project_ref_hint=fxlojnqwyojqjskfggmh"
  echo "includes_storage_bytes=no"
} > "$DEST/MANIFEST.txt"

echo "Done. Storage files were NOT copied. See STAGE11_RECOVERY.md section 3.C"
echo "$DEST"
