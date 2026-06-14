#!/usr/bin/env bash
# post-run sanity floors for a browser-verify run.
#
# enforces three floors after the scenario completes:
#   1. wall-clock duration ≥ 3 s (computed from summary.json)
#   2. asserts.jsonl has at least one row (evidence-grade assertion ran)
#   3. final report cites at least one path from the PR diff
#
# usage:
#   scripts/verify-sanity-floors.sh <runDir> <comment-body-file> <changed-files-list>
#
# exits 0 on pass, 1 on fail (with stderr lines describing the violations),
# 2 on usage error / missing run dir.

set -euo pipefail

RUNDIR="${1:-}"
BODY_FILE="${2:-}"
CHANGED="${3:-}"

if [ -z "$RUNDIR" ] || [ -z "$BODY_FILE" ] || [ -z "$CHANGED" ]; then
  echo "usage: $0 <runDir> <comment-body-file> <changed-files-list>" >&2
  exit 2
fi
if [ ! -d "$RUNDIR" ]; then
  echo "run dir not found: $RUNDIR" >&2
  exit 2
fi

SUMMARY="$RUNDIR/summary.json"
ASSERTS="$RUNDIR/asserts.jsonl"

FAILS=()

# floor 1: wall-clock ≥ 3 s
if [ -f "$SUMMARY" ]; then
  DUR=$(python3 - "$SUMMARY" <<'PY'
import json, sys
from datetime import datetime
def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
d = json.load(open(sys.argv[1]))
print(f"{ts(d['endedAt']) - ts(d['startedAt']):.3f}")
PY
)
  if python3 -c "import sys; sys.exit(0 if float('$DUR') < 3.0 else 1)"; then
    FAILS+=("scenario wall-clock ${DUR}s < 3.0s minimum — real flows take longer (PR #269 reference failure was 1.88s)")
  fi
else
  FAILS+=("missing summary.json at $SUMMARY")
fi

# floor 2: asserts.jsonl has rows
if [ ! -s "$ASSERTS" ]; then
  FAILS+=("asserts.jsonl is missing or empty — no evidence-grade assertion ran (use assertRenderedValue)")
fi

# floor 3: final report cites at least one changed file
if [ ! -f "$BODY_FILE" ]; then
  FAILS+=("final-report body file not found at $BODY_FILE")
elif [ ! -s "$CHANGED" ]; then
  : # no changed files — nothing to require
else
  HIT=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if grep -qF -- "$f" "$BODY_FILE"; then
      HIT=1
      break
    fi
  done < "$CHANGED"
  if [ "$HIT" = "0" ]; then
    FAILS+=("final report cites no path from gh pr diff --name-only — incomplete evidence (the asserted UI must trace back to a changed file)")
  fi
fi

if [ ${#FAILS[@]} -gt 0 ]; then
  printf 'verify sanity-floors failed for %s:\n' "$RUNDIR" >&2
  for f in "${FAILS[@]}"; do
    printf -- '- %s\n' "$f" >&2
  done
  exit 1
fi

echo "verify sanity-floors passed: $RUNDIR"
