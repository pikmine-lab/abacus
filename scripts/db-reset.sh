#!/usr/bin/env bash
# Rebuild the database this checkout's app opens: dropped, recreated, migrated
# and seeded.
#
# Every worktree has its own database on the shared dev instance, named in its
# apps/web/.env.local, so the reset targets that one and leaves the others and
# the volume alone. Starting over from an empty volume is `nr db:down -v`.
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=apps/web/.env.local
local_prefix=postgresql://abacus:abacus@127.0.0.1:5544/

url=$(sed -n 's/^DATABASE_URL=//p' "$env_file")
case "$url" in
  "$local_prefix"*) ;;
  *)
    echo "$env_file does not point at the local dev database ($local_prefix…), nothing was reset." >&2
    exit 1
    ;;
esac
database=${url#"$local_prefix"}
if [[ ! $database =~ ^[a-z0-9_]+$ ]]; then
  echo "Unexpected database name in $env_file: $database" >&2
  exit 1
fi

# `exec` only, never `up`: the bind mount of the init script is a path inside
# the primary worktree, so `up` from another one recreates the shared container.
compose=(docker compose -f compose.dev.yml)
if [ -z "$("${compose[@]}" ps --status running --quiet db)" ]; then
  echo 'The dev database is not running: start it with `nr db:up` from the primary worktree.' >&2
  exit 1
fi
psql() { "${compose[@]}" exec -T db psql -U abacus -v ON_ERROR_STOP=1 --quiet "$@"; }

# FORCE closes the connections still open, the dev server's first.
psql -d postgres \
  -c "DROP DATABASE IF EXISTS $database WITH (FORCE)" \
  -c "CREATE DATABASE $database"
# The same extensions as scripts/dev-db-init.sql, which only runs on an empty volume.
psql -d "$database" \
  -c 'create extension if not exists vector' \
  -c 'create extension if not exists pg_trgm' \
  -c 'create extension if not exists unaccent'

node --env-file="$env_file" packages/core/src/db/migrate.ts
node --env-file="$env_file" packages/data-seed/src/main.ts
