#!/usr/bin/env bash
# ============================================================================
# Daily Local Database Backup
#
# Runs pg_dump (custom format) against the postgres service from
# docker-compose.yml and writes a timestamped dump to a configurable
# directory. Old dumps beyond the retention count are pruned.
#
# Env overrides:
#   POSTGRES_DB        default: tarmacview
#   POSTGRES_USER      default: tarmacview
#   BACKUP_DIR         default: <repo>/backups
#   BACKUP_RETENTION   default: 30
#   COMPOSE_SERVICE    default: postgres
#
# Exit 0: dump written and pruning ran.
# Exit 1: postgres container not running, or pg_dump failed.
# ============================================================================
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

POSTGRES_DB="${POSTGRES_DB:-tarmacview}"
POSTGRES_USER="${POSTGRES_USER:-tarmacview}"
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-30}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"

# basic sanity checks
if ! [[ "$BACKUP_RETENTION" =~ ^[0-9]+$ ]] || (( BACKUP_RETENTION < 1 )); then
  echo "Error: BACKUP_RETENTION must be a positive integer (got '${BACKUP_RETENTION}')" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker not found on PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

cd "$REPO_ROOT"

# verify the postgres container is running
running_services="$(docker compose ps --status running --services 2>/dev/null || true)"
if ! echo "$running_services" | grep -qxF "$COMPOSE_SERVICE"; then
  echo "Error: compose service '${COMPOSE_SERVICE}' is not running" >&2
  echo "  start it with: docker compose up -d ${COMPOSE_SERVICE}" >&2
  exit 1
fi

# timestamped output, atomic rename via .partial
TS="$(date -u +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/tarmacview-${TS}.dump"
PARTIAL="${OUT}.partial"

echo "Dumping ${POSTGRES_DB} from container '${COMPOSE_SERVICE}' -> ${OUT}"

if ! docker compose exec -T "$COMPOSE_SERVICE" \
    pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$PARTIAL"; then
  echo "Error: pg_dump failed" >&2
  rm -f "$PARTIAL"
  exit 1
fi

mv "$PARTIAL" "$OUT"

# prune oldest dumps beyond retention
# avoid mapfile (bash 4+ only) so this works on macOS system bash 3.2
dumps=()
while IFS= read -r f; do
  dumps+=("$f")
done < <(ls -t "$BACKUP_DIR"/tarmacview-*.dump 2>/dev/null || true)

removed=0
if (( ${#dumps[@]} > BACKUP_RETENTION )); then
  for stale in "${dumps[@]:BACKUP_RETENTION}"; do
    rm -f -- "$stale"
    removed=$((removed + 1))
  done
fi

remaining=$(( ${#dumps[@]} > BACKUP_RETENTION ? BACKUP_RETENTION : ${#dumps[@]} ))
size="$(du -h "$OUT" | cut -f1)"

echo "Wrote ${OUT} (${size})"
echo "Retention: keeping ${remaining} of last ${BACKUP_RETENTION}; pruned ${removed}"
