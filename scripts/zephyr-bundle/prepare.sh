#!/usr/bin/env bash
# prepare a zip of the codebase ready to ship to zephyr colleagues.
#
# what it does (in order):
#   1. sanity-checks the working tree (clean, warns if on main)
#   2. ALWAYS regenerates db/initdb/01-seed.sql via scripts/regenerate-db-seed.sh
#      (ephemeral postgres + alembic + python seeder; needs OPENAIP_API_KEY for
#      the 5 openaip airports).
#   3. ALWAYS regenerates db/01-seed.full.sql by pg_dumping the maintainer's
#      live local DB (container tarmacview-db). this captures any demo missions
#      the maintainer has built in the UI beyond what the auto-seeder creates.
#      excludes audit_log and elevation_cache from the dump.
#   4. picks which one ships as the bundle's db/initdb/01-seed.sql based on
#      --seed-source=demo|full (REQUIRED flag - no implicit default).
#   5. stages tracked files (git ls-files filtered through trim.txt) into
#      out/zephyr-bundle/tarmacview/ - claude/harnext artifacts, internal
#      docs and dev scripts get dropped.
#   6. moves docs/specs/diagrams -> docs/diagrams (so the diagrams stay
#      reachable after docs/specs/ is mostly emptied).
#   7. drops the chosen seed into staging/db/initdb/01-seed.sql.
#   8. rewrites INSTALL.md / README.md to drop links to trimmed files.
#   9. zips the result into out/zephyr-bundle-<date>.zip.
#
# colleagues at zephyr extract the zip, install docker desktop, and run
# `./start.sh` (mac/linux) or `start.bat` (windows). first boot loads the
# bundled seed; subsequent boots reuse the volume.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/scripts/zephyr-bundle"
cd "$REPO_ROOT"

# defaults
SEED_SOURCE_CHOICE=""
ALLOW_DIRTY=0
OUT_DIR="$REPO_ROOT/out"
BUNDLE_DATE="$(date +%Y-%m-%d)"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-tarmacview-db}"
LOCAL_DB_USER="${LOCAL_DB_USER:-tarmacview}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-tarmacview}"

usage() {
  cat <<USAGE
usage: prepare.sh --seed-source=<demo|full> [options]

required:
  --seed-source=demo   ship the freshly regenerated demo seed
                       (db/initdb/01-seed.sql) as the bundle's init seed.
                       what auto-seeder produces: 5 openaip airports,
                       9 drones, 2 templates, 3 users, no demo missions
                       beyond what the seeder bakes in.
  --seed-source=full   ship the freshly dumped maintainer DB
                       (db/01-seed.full.sql) as the bundle's init seed.
                       includes any demo missions the maintainer has built
                       in the UI on top of the auto-seed.

options:
  --allow-dirty        skip the clean-working-tree check (use sparingly)
  --out DIR            output directory (default: ./out)
  -h, --help           this message

regeneration is always-on. both seeds are rebuilt every run:
  - demo: ephemeral postgres + alembic + python seeder (needs OPENAIP_API_KEY)
  - full: pg_dump from \$LOCAL_DB_CONTAINER (default: tarmacview-db). that
    container must be up and healthy - start it with ./start.sh if not.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed-source=*) SEED_SOURCE_CHOICE="${1#*=}"; shift ;;
    --seed-source) SEED_SOURCE_CHOICE="$2"; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$SEED_SOURCE_CHOICE" != "demo" && "$SEED_SOURCE_CHOICE" != "full" ]]; then
  echo "error: --seed-source=demo|full is required" >&2
  usage >&2
  exit 2
fi

log()   { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m!!\033[0m  %s\n' "$*" >&2; }
die()   { printf '\033[31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

# preflight
log "preflight checks"
command -v rsync   >/dev/null 2>&1 || die "rsync not on PATH"
command -v zip     >/dev/null 2>&1 || die "zip not on PATH (try: brew install zip)"
command -v python3 >/dev/null 2>&1 || die "python3 not on PATH"
command -v git     >/dev/null 2>&1 || die "git not on PATH"

if [[ "$ALLOW_DIRTY" -eq 0 ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "working tree is dirty - commit/stash first, or pass --allow-dirty"
  fi
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" == "main" ]]; then
  warn "you're on main. the bundle reflects current main exactly."
fi

# always regenerate the demo seed (ephemeral postgres + alembic + seeder).
# this captures the current schema and the auto-seeded base content.
log "regenerating demo seed db/initdb/01-seed.sql (this takes a minute)"
bash "$REPO_ROOT/scripts/regenerate-db-seed.sh"

# always regenerate the full seed by dumping the maintainer's running local DB.
# this captures any demo missions the maintainer built in the UI beyond the
# auto-seeded base. excludes audit_log + elevation_cache (noise + bulk).
log "regenerating full seed db/01-seed.full.sql from $LOCAL_DB_CONTAINER"
if ! docker ps --format '{{.Names}}' | grep -qx "$LOCAL_DB_CONTAINER"; then
  die "local DB container '$LOCAL_DB_CONTAINER' is not running. start it with ./start.sh, then re-run."
fi
mkdir -p "$REPO_ROOT/db"
docker exec "$LOCAL_DB_CONTAINER" \
  pg_dump -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" \
  --no-owner --no-privileges \
  --exclude-table-data=audit_log \
  --exclude-table-data=elevation_cache \
  > "$REPO_ROOT/db/01-seed.full.sql"
log "wrote db/01-seed.full.sql ($(wc -c < "$REPO_ROOT/db/01-seed.full.sql") bytes)"

# pick the seed per --seed-source
if [[ "$SEED_SOURCE_CHOICE" == "full" ]]; then
  SEED_SOURCE="$REPO_ROOT/db/01-seed.full.sql"
  log "ship choice: db/01-seed.full.sql (maintainer DB, includes demo missions)"
else
  SEED_SOURCE="$REPO_ROOT/db/initdb/01-seed.sql"
  log "ship choice: db/initdb/01-seed.sql (clean auto-seed, no demo missions)"
fi

# staging - the directory name becomes the tarball's top-level entry
STAGING_PARENT="$OUT_DIR/zephyr-bundle"
STAGING="$STAGING_PARENT/tarmacview"
log "staging at $STAGING"
rm -rf "$STAGING_PARENT"
mkdir -p "$STAGING"

# copy tracked files only, minus the trim manifest. staging from
# `git ls-files` (not the working tree) means working-tree clutter
# (.DS_Store, chrome/, backups/, half-finished WIP) cannot leak in.
log "filtering tracked files through trim.txt"
FILE_LIST="$STAGING_PARENT/files-to-ship.txt"
git ls-files | python3 "$SCRIPT_DIR/filter-files.py" "$SCRIPT_DIR/trim.txt" > "$FILE_LIST"
TRACKED_TOTAL="$(git ls-files | wc -l | tr -d ' ')"
SHIPPED_TOTAL="$(wc -l < "$FILE_LIST" | tr -d ' ')"
log "shipping $SHIPPED_TOTAL of $TRACKED_TOTAL tracked files"

log "rsync filtered list -> staging"
rsync -a --files-from="$FILE_LIST" "$REPO_ROOT/" "$STAGING/"

# move diagrams
if [[ -d "$STAGING/docs/specs/diagrams" ]]; then
  log "moving docs/specs/diagrams -> docs/diagrams"
  mv "$STAGING/docs/specs/diagrams" "$STAGING/docs/diagrams"
fi
# clean up empty docs/specs/ left behind
if [[ -d "$STAGING/docs/specs" ]] && [[ -z "$(ls -A "$STAGING/docs/specs")" ]]; then
  rmdir "$STAGING/docs/specs"
fi

# install the chosen seed at the canonical path
log "writing db/initdb/01-seed.sql"
mkdir -p "$STAGING/db/initdb"
cp "$SEED_SOURCE" "$STAGING/db/initdb/01-seed.sql"

# rewrite the two docs that link to trimmed paths
log "rewriting INSTALL.md and README.md"
python3 "$SCRIPT_DIR/edit-docs.py" "$STAGING"

# sanity: nothing in the staging tree should point at a trimmed path
log "sanity-checking links to trimmed files"
sanity_misses=0
for tracked in CLAUDE.md OPERATIONS.md CONTEXT.md docs/specs/SPEC.md \
               docs/conventions.md docs/adr docs/audits harness.config.json \
               chrome backups .claude .codacy.yaml .pre-commit-config.yaml; do
  if [[ -e "$STAGING/$tracked" ]]; then
    warn "trimmed path still present in staging: $tracked"
    sanity_misses=$((sanity_misses + 1))
  fi
done
if [[ "$sanity_misses" -gt 0 ]]; then
  die "$sanity_misses trimmed paths leaked into the bundle - update trim.txt"
fi

# zip it up - .zip is friendlier on windows than .tar.gz (double-click
# extracts in explorer; no third-party tool required)
BUNDLE="$OUT_DIR/zephyr-bundle-${BUNDLE_DATE}.zip"
log "creating zip $BUNDLE"
rm -f "$BUNDLE"
(cd "$STAGING_PARENT" && zip -rq "$BUNDLE" tarmacview)

# report
SIZE="$(du -h "$BUNDLE" | awk '{print $1}')"
COUNT="$(unzip -l "$BUNDLE" | tail -1 | awk '{print $2}')"
SEED_LINES="$(wc -l < "$STAGING/db/initdb/01-seed.sql" | tr -d ' ')"

printf '\n\033[32mdone.\033[0m\n'
printf '  bundle  : %s (%s)\n' "$BUNDLE" "$SIZE"
printf '  entries : %s\n' "$COUNT"
printf '  seed    : %s lines from %s\n' "$SEED_LINES" "${SEED_SOURCE#$REPO_ROOT/}"
printf '  source  : branch=%s sha=%s\n' "$current_branch" "$(git rev-parse --short HEAD)"
printf '\nship %s to zephyr.\n' "$(basename "$BUNDLE")"
