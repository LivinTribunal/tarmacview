#!/usr/bin/env bash
# regenerate db/initdb/01-seed.sql against the current alembic head.
#
# spins up an ephemeral postgres:16 container, runs `alembic upgrade head`,
# runs `python -m app.seed` with SEED_USERS=true, pg_dumps the result over
# db/initdb/01-seed.sql, and tears the container down.
#
# Idempotent modulo:
# - rows where the seeder calls uuid4() for the primary key (every airport,
#   airfield_surface, obstacle, safety_zone, drone_profile, inspection_template,
#   inspection_configuration, user, etc.). Re-running produces fresh ids.
# - user.created_at / updated_at on the three seeded users.
# - inspection_template.created_at on the two seeded templates.
# - any timestamp default that resolves to NOW() inside the seeder.
#
# Re-running should leave the dump byte-stable in every other column. If you
# see diffs outside that list, the seeder grew a new non-deterministic field
# and this header needs an update.
#
# Requires: docker, network access for openaip lookups (5 airports), python
# venv at backend/.venv (created on demand), alembic, app.seed. Airport
# seeding needs OPENAIP_API_KEY set in the calling shell - without it, each
# airport lookup fails (the seeder logs the miss and moves on) and the
# bundled dump ships with drones + templates + users but no airports / surfaces
# / obstacles / safety zones. Run locally with the key set before committing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CONTAINER_NAME="tarmacview-seed-pg"
DB_USER="tarmacview"
DB_PASSWORD="tarmacview"
DB_NAME="tarmacview"
# host-side published port; avoids clashing with a running compose stack on :5432
DB_PORT="${SEED_DB_PORT:-55432}"
DUMP_PATH="db/initdb/01-seed.sql"

cleanup() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# scrub any leftover from a previous interrupted run
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "==> starting ephemeral postgres:16 on :$DB_PORT"
docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -e "POSTGRES_USER=$DB_USER" \
  -e "POSTGRES_PASSWORD=$DB_PASSWORD" \
  -e "POSTGRES_DB=$DB_NAME" \
  -p "127.0.0.1:$DB_PORT:5432" \
  postgres:16 >/dev/null

echo "==> waiting for postgres healthy"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 || {
  echo "postgres did not become healthy"
  docker logs "$CONTAINER_NAME" | tail -n 50
  exit 1
}

# backend deps - idempotent venv create + install
echo "==> ensure backend venv (backend/.venv)"
if [ ! -f backend/.venv/bin/alembic ] \
    || ! diff -q backend/requirements.txt backend/.venv/.req-snapshot >/dev/null 2>&1; then
  echo "    creating venv and installing requirements..."
  rm -rf backend/.venv
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --upgrade pip >/dev/null
  backend/.venv/bin/pip install -r backend/requirements.txt >/dev/null
  cp backend/requirements.txt backend/.venv/.req-snapshot
else
  echo "    venv up to date - skipping install"
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate

export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:$DB_PORT/$DB_NAME"
export PYTHONPATH="$REPO_ROOT/backend"
# seeder.py only seeds users when SEED_USERS=true (see backend/app/services/seeder.py).
export SEED_USERS=true
# OPENAIP_API_KEY is read from the calling shell when present; without it
# every airport lookup fails gracefully and the dump ships with no airports.
if [ -z "${OPENAIP_API_KEY:-}" ]; then
  echo "    WARNING: OPENAIP_API_KEY is not set - airports will not be seeded"
fi

echo "==> alembic upgrade head"
(cd backend && alembic upgrade head)

echo "==> python -m app.seed (airports, drones, templates, users)"
(cd backend && python -m app.seed)
# app.seed only triggers seed_airports / seed_drone_profiles / seed_inspection_templates;
# the user seeder runs from app.main lifecycle, so call it explicitly here.
(cd backend && python -c "from app.core.database import SessionLocal; from app.services.seeder import seed_users; db = SessionLocal(); seed_users(db); db.close()")

echo "==> pg_dump -> $DUMP_PATH"
mkdir -p "$(dirname "$DUMP_PATH")"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  > "$DUMP_PATH"

echo "==> regenerated $DUMP_PATH ($(wc -c < "$DUMP_PATH") bytes)"
echo "==> done"
