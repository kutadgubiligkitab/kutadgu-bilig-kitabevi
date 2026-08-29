#!/usr/bin/env bash
# DESTRUCTIVE. Restores a logical dump into the database in SUPABASE_DB_URL.
# This script never runs unless you set both confirmation variables.
# Prefer Supabase Dashboard → Database → Backups for Pro/PITR restores.
#
#   export SUPABASE_DB_URL='postgresql://...'
#   export KUTADGU_RESTORE_CONFIRM=RESTORE_PRODUCTION_NOW
#   export KUTADGU_RESTORE_PROJECT_REF=fxlojnqwyojqjskfggmh
#   ./scripts/restore-from-dump.sh backups/local/<timestamp>
#
# Not wired to CI. Do not add a GitHub Action that calls this.
set -euo pipefail

DUMP_DIR="${1:-}"
EXPECTED_REF="fxlojnqwyojqjskfggmh"

if [[ "${KUTADGU_RESTORE_CONFIRM:-}" != "RESTORE_PRODUCTION_NOW" ]]; then
  echo "Refusing restore. This command can overwrite production." >&2
  echo "If you are sure, export KUTADGU_RESTORE_CONFIRM=RESTORE_PRODUCTION_NOW" >&2
  exit 1
fi

if [[ "${KUTADGU_RESTORE_PROJECT_REF:-}" != "$EXPECTED_REF" ]]; then
  echo "Refusing restore. Set KUTADGU_RESTORE_PROJECT_REF=$EXPECTED_REF" >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Refusing: SUPABASE_DB_URL is not set." >&2
  exit 1
fi

if [[ -z "$DUMP_DIR" || ! -s "$DUMP_DIR/schema.sql" || ! -s "$DUMP_DIR/data.sql" ]]; then
  echo "Usage: $0 backups/local/<timestamp>  (needs schema.sql and data.sql)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for this helper. Dashboard restore is safer on Pro." >&2
  exit 1
fi

echo "WARNING: about to restore $DUMP_DIR into SUPABASE_DB_URL (password hidden)."
echo "This overwrites database objects/data from that dump. Storage bytes are not restored."
echo "Waiting 8 seconds… Ctrl+C to abort."
sleep 8

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$DUMP_DIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$DUMP_DIR/data.sql" \
  --dbname "$SUPABASE_DB_URL"

echo "Restore finished. Run smoke tests (docs/EMERGENCY.md). Re-upload Storage if covers are missing."
