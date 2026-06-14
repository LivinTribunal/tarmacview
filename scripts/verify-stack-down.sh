#!/usr/bin/env bash
# tear down the verify stack: kill backend + frontend, drop ephemeral db.
# leaves the postgres container running (it's the user's regular dev container).
# safe to call repeatedly; safe to call when the stack is partially up.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STATE_DIR="$REPO_ROOT/.harnext"
STATE_FILE="$STATE_DIR/verify-stack.state"
DB_USER="${POSTGRES_USER:-tarmacview}"

kill_pidfile() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 0
  local pid
  pid="$(cat "$pidfile")"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$pidfile"
}

echo "==> stop backend"
kill_pidfile "$STATE_DIR/backend.pid"

echo "==> stop frontend"
kill_pidfile "$STATE_DIR/frontend.pid"

# best-effort port-based cleanup in case PID files were stale
for port in "${VERIFY_BACKEND_PORT:-8001}" "${VERIFY_FRONTEND_PORT:-5174}"; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "==> killing leftover listeners on :$port — $pids"
    echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
  fi
done

if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  if [ -n "${VERIFY_DB:-}" ]; then
    echo "==> drop ephemeral db $VERIFY_DB"
    docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c \
      "DROP DATABASE IF EXISTS $VERIFY_DB;" >/dev/null 2>&1 || true
  fi
  rm -f "$STATE_FILE"
fi

echo "==> teardown complete"
