#!/usr/bin/env bash
# bring up the verify stack: postgres + ephemeral db + backend on :8001 + frontend on :5174.
# emits a state file under .harnext/verify-stack.state with PIDs and the verify db name.
#
# self-hosted runner notes:
# - workspace must be checked out with `clean: false` so .venv / node_modules
#   persist between runs (they are gitignored, so a clean checkout would wipe
#   them every time and force a 90s re-install).
# - all output goes to stdout so the GH Actions log shows it directly.
#   no log files; the surrounding action log is the source of truth.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STATE_DIR="$REPO_ROOT/.harnext"
STATE_FILE="$STATE_DIR/verify-stack.state"
mkdir -p "$STATE_DIR"

VERIFY_DB="tarmacview_verify"
DB_USER="${POSTGRES_USER:-tarmacview}"
DB_PASS="${POSTGRES_PASSWORD:-tarmacview}"
BACKEND_PORT="${VERIFY_BACKEND_PORT:-8001}"
FRONTEND_PORT="${VERIFY_FRONTEND_PORT:-5174}"

# docker-compose parses the whole compose file at startup, even when only
# starting one service. backend declares `JWT_SECRET: ${JWT_SECRET:?...}`
# which fails the parse if the host shell has no JWT_SECRET set. verify
# only brings up postgres (backend runs natively via uvicorn) and uses an
# ephemeral DB with no real users, so a stable placeholder is sufficient.
# explicit `${VAR:-default}` lets the runner shell still override.
export JWT_SECRET="${JWT_SECRET:-verify-test-secret-not-for-production}"

# backend deps - idempotent venv create + install
echo "==> ensure backend venv (backend/.venv)"
if [ ! -f backend/.venv/bin/alembic ] \
    || ! diff -q backend/requirements.txt backend/.venv/.req-snapshot >/dev/null 2>&1; then
  echo "    creating venv and installing requirements..."
  rm -rf backend/.venv
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --upgrade pip
  backend/.venv/bin/pip install -r backend/requirements.txt
  cp backend/requirements.txt backend/.venv/.req-snapshot
else
  echo "    venv up to date — skipping install"
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate

# frontend deps - idempotent npm ci
echo "==> ensure frontend node_modules"
if [ ! -d frontend/node_modules ] \
    || ! diff -q frontend/package-lock.json frontend/node_modules/.lock-snapshot >/dev/null 2>&1; then
  echo "    running npm ci..."
  (cd frontend && npm ci --no-audit --no-fund)
  cp frontend/package-lock.json frontend/node_modules/.lock-snapshot
else
  echo "    node_modules up to date — skipping install"
fi

echo "==> postgres compose up"
docker compose up -d postgres

echo "==> wait for postgres healthy"
for _ in {1..30}; do
  if docker compose exec -T postgres pg_isready -U "$DB_USER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T postgres pg_isready -U "$DB_USER" >/dev/null 2>&1 || {
  echo "postgres did not become healthy"; exit 1;
}

# the pgdata volume persists across runs and may have been initdb'd against
# an older glibc (e.g. 2.31 in the original postgres:16 image). when the
# image picks up a newer glibc (2.41), CREATE DATABASE refuses to copy from
# template1 with a collation version mismatch. refreshing the version is
# non-destructive: it just acknowledges that the new locale rules apply.
# (don't recreate the volume - it's shared with local dev pgdata.)
echo "==> refresh postgres collation versions (host glibc may have moved)"
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "ALTER DATABASE postgres REFRESH COLLATION VERSION;" >/dev/null 2>&1 || true
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "ALTER DATABASE template1 REFRESH COLLATION VERSION;" >/dev/null 2>&1 || true

echo "==> recreate ephemeral db $VERIFY_DB"
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "DROP DATABASE IF EXISTS $VERIFY_DB;"
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c \
  "CREATE DATABASE $VERIFY_DB;"
# postgis is no longer required - spatial computation moved in-process to
# Shapely. geometry is stored as WKT strings in sa.String columns.

VERIFY_DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$VERIFY_DB"
export DATABASE_URL="$VERIFY_DB_URL"
# alembic loads backend/migrations/env.py which does `import app.models`.
# the backend/ dir must be on sys.path or that import fails.
# alembic.ini has no prepend_sys_path setting, so we set it explicitly here.
export PYTHONPATH="$REPO_ROOT/backend"

echo "==> alembic upgrade head"
(cd backend && alembic upgrade head)

echo "==> seed default users + reference data"
(cd backend && python -m app.seed)

echo "==> start backend on :$BACKEND_PORT"
(
  cd backend
  DATABASE_URL="$VERIFY_DB_URL" PYTHONPATH="$REPO_ROOT/backend" \
    nohup uvicorn app.main:app --port "$BACKEND_PORT" --host 127.0.0.1 \
    > "$STATE_DIR/backend.out" 2>&1 &
  echo $! > "$STATE_DIR/backend.pid"
)

echo "==> wait for backend health"
for _ in {1..40}; do
  if curl -sf "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -sf "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null || {
  echo "backend did not become healthy — last 50 lines of backend output:"
  tail -n 50 "$STATE_DIR/backend.out"
  exit 1
}

echo "==> start frontend on :$FRONTEND_PORT"
(
  cd frontend
  VITE_API_PROXY_TARGET="http://localhost:$BACKEND_PORT" \
    nohup npm run dev -- --port "$FRONTEND_PORT" --host 127.0.0.1 \
    > "$STATE_DIR/frontend.out" 2>&1 &
  echo $! > "$STATE_DIR/frontend.pid"
)

echo "==> wait for frontend"
for _ in {1..60}; do
  if curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null || {
  echo "frontend did not respond — last 50 lines of frontend output:"
  tail -n 50 "$STATE_DIR/frontend.out"
  exit 1
}

cat > "$STATE_FILE" <<EOF
VERIFY_DB=$VERIFY_DB
VERIFY_DB_URL=$VERIFY_DB_URL
BACKEND_PID=$(cat "$STATE_DIR/backend.pid")
BACKEND_PORT=$BACKEND_PORT
FRONTEND_PID=$(cat "$STATE_DIR/frontend.pid")
FRONTEND_PORT=$FRONTEND_PORT
VERIFY_BACKEND_URL=http://localhost:$BACKEND_PORT
VERIFY_FRONTEND_URL=http://localhost:$FRONTEND_PORT
EOF

echo "==> stack ready"
cat "$STATE_FILE"
