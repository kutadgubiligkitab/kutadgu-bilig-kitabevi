#!/bin/bash
# Apply Stage 127 on a throwaway local database. Does not use production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage127_$$"
cleanup() {
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
}
trap cleanup EXIT
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${DB}\";" >/dev/null
psql_db() {
  sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

psql_db -f "$ROOT/scripts/stage127-isolated-fixture.sql" >/dev/null
before="$(psql_db -tA -c "SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY id)) FROM public.books AS b")"
psql_db -f "$ROOT/STAGE127_BOOK_VOLUME_GROUPS.sql" >/dev/null
psql_db -f "$ROOT/STAGE127_BOOK_VOLUME_GROUPS.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage127-isolated-assertions.sql" >/dev/null
after="$(psql_db -tA -c "SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY id)) FROM public.books AS b")"
if [[ "$before" == "$after" ]]; then
  echo "expected assertion price changes were not observed" >&2
  exit 1
fi

rows="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_groups")"
members="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_group_members")"
psql_db -f "$ROOT/STAGE127_BOOK_VOLUME_GROUPS_ROLLBACK.sql" >/dev/null
kept_rows="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_groups")"
kept_members="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_group_members")"
if [[ "$rows" != "$kept_rows" || "$members" != "$kept_members" ]]; then
  echo "rollback removed group data ${rows}/${members} -> ${kept_rows}/${kept_members}" >&2
  exit 1
fi
if psql_db -tA -c "SELECT to_regprocedure('public.admin_save_book_volume_group(bigint,bigint,jsonb,jsonb)')" | grep -q admin_save; then
  echo "rollback left admin mutation RPC" >&2
  exit 1
fi
echo "STAGE127 isolated postgres: PASS groups=${rows} members=${members}"
