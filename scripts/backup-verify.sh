#!/usr/bin/env bash
# Checks a backup folder looks complete. Does not connect to production.
#   ./scripts/backup-verify.sh backups/local/20260101T000000Z
set -euo pipefail
DIR="${1:-}"
if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "Usage: $0 backups/local/<timestamp>" >&2
  exit 1
fi
fail=0
for f in schema.sql data.sql MANIFEST.txt; do
  if [[ ! -s "$DIR/$f" ]]; then
    echo "MISSING or empty: $DIR/$f" >&2
    fail=1
  else
    echo "OK $f ($(wc -c < "$DIR/$f") bytes)"
  fi
done
if grep -q 'includes_storage_bytes=no' "$DIR/MANIFEST.txt" 2>/dev/null; then
  echo "NOTE: this dump does not include book-covers file bytes."
fi
exit "$fail"
