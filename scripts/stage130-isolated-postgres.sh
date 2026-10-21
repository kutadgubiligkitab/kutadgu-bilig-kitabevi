#!/bin/bash
# Apply Stages 127/128/130 on a throwaway local database. Never production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="kutadgu_stage130_$$"
cleanup() {
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null || true
}
trap cleanup EXIT

sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"${DB}\";" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q \
  -c "CREATE DATABASE \"${DB}\";" >/dev/null

psql_db() {
  sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

psql_db -f "$ROOT/scripts/stage127-isolated-fixture.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage130-isolated-fixture.sql" >/dev/null
books_before="$(psql_db -tA -c \
  "SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY id)) FROM public.books AS b")"

psql_db -f "$ROOT/STAGE127_BOOK_VOLUME_GROUPS.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage128-isolated-fixture.sql" >/dev/null
psql_db -f "$ROOT/STAGE128_BOOK_VOLUME_COMMERCE.sql" >/dev/null
psql_db -f "$ROOT/STAGE130_BOOK_VOLUME_STOREFRONT.sql" >/dev/null
psql_db -f "$ROOT/STAGE130_BOOK_VOLUME_STOREFRONT.sql" >/dev/null
psql_db -f "$ROOT/scripts/stage130-isolated-assertions.sql" >/dev/null

books_after="$(psql_db -tA -c \
  "SELECT md5(string_agg(row_to_json(b)::text, ',' ORDER BY id)) FROM public.books AS b")"
if [[ "$books_before" != "$books_after" ]]; then
  echo "Stage 130 assertions or publication rewrote books" >&2
  exit 1
fi

psql_db -q -c "
  INSERT INTO public.orders (
    order_no, user_id, status, items, total, total_qty
  ) VALUES (
    'KB-261020-STAGE130',
    '11111111-1111-4111-8111-111111111111',
    'prepared',
    '[{\"book_id\":170,\"title\":\"Rollback sentinel\",\"price\":1700,\"qty\":1,\"line_total\":1700}]',
    1700,
    1
  );
" >/dev/null

groups_before="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_groups")"
members_before="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_group_members")"
orders_before="$(psql_db -tA -c "SELECT count(*) FROM public.orders")"

psql_db -f "$ROOT/STAGE130_BOOK_VOLUME_STOREFRONT_ROLLBACK.sql" >/dev/null

groups_after="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_groups")"
members_after="$(psql_db -tA -c "SELECT count(*) FROM public.book_volume_group_members")"
orders_after="$(psql_db -tA -c "SELECT count(*) FROM public.orders")"
if [[ "$groups_before" != "$groups_after" ||
      "$members_before" != "$members_after" ||
      "$orders_before" != "$orders_after" ]]; then
  echo "rollback touched groups, memberships, or orders" >&2
  exit 1
fi

if [[ -n "$(psql_db -tA -c \
  "SELECT to_regprocedure('public.list_public_book_volume_catalog(text,text,text,numeric,numeric,boolean,boolean,boolean,boolean,text,integer,integer)')")" ]]; then
  echo "rollback left the Stage 130 public catalog RPC" >&2
  exit 1
fi
if [[ -n "$(psql_db -tA -c \
    "SELECT to_regprocedure('public.query_public_book_catalog(jsonb)')")" ||
      -n "$(psql_db -tA -c \
    "SELECT to_regprocedure('public.map_public_books_to_catalog_units(bigint[])')")" ]]; then
  echo "rollback left a Stage 130 grouped caller RPC" >&2
  exit 1
fi
if [[ -z "$(psql_db -tA -c \
  "SELECT to_regprocedure('public.admin_save_book_volume_group(bigint,bigint,jsonb,jsonb)')")" ||
      -z "$(psql_db -tA -c \
  "SELECT to_regprocedure('public.quote_book_volume_cart(jsonb)')")" ]]; then
  echo "rollback removed a Stage 127/128 function" >&2
  exit 1
fi

echo "STAGE130 isolated postgres: PASS groups=${groups_after} members=${members_after} orders=${orders_after}"
