#!/usr/bin/env bash
# static lint of a browser-verify scenario.mjs.
#
# enforces three gates against a model-emitted scenario:
#   1. no DOM-mutation patterns (synthetic-DOM injection — see issue #289)
#   2. at least one real user interaction before the first assertRenderedValue
#   3. best-effort route relevance: scenario lands on a page module that
#      mentions at least one changed-file basename
#
# usage:
#   scripts/verify-lint-scenario.sh <scenario.mjs> [<changed-files-list>]
#
# exits 0 on pass, 1 on fail (with stderr lines describing the violations),
# 2 on usage error / missing scenario.

set -euo pipefail

SCENARIO="${1:-}"
CHANGED="${2:-}"

if [ -z "$SCENARIO" ]; then
  echo "usage: $0 <scenario.mjs> [<changed-files-list>]" >&2
  exit 2
fi
if [ ! -f "$SCENARIO" ]; then
  echo "scenario not found: $SCENARIO" >&2
  exit 2
fi

FAILS=()

# gate 1: DOM-mutation patterns
# reading state via evaluate_script (querySelector, getComputedStyle, returning
# values) is fine — the rule targets DOM mutation, not all evaluate calls. the
# last alternative catches HTML literals embedded in evaluate(...) calls.
DOM_RE='addStyleTag|addScriptTag|setContent|appendChild|insertAdjacentHTML|innerHTML[[:space:]]*=|outerHTML[[:space:]]*=|evaluate\([^)]*<[^>]+>'
if dom_hits=$(grep -nE "$DOM_RE" "$SCENARIO" 2>/dev/null); then
  FAILS+=("DOM-mutation pattern (synthetic DOM forbidden — see issue #289):
$dom_hits")
fi

# gate 2: real interaction before first assertRenderedValue *call*
# match the call form (`assertRenderedValue(`) so we don't trip on the import
# line — every real scenario imports the symbol at the top before any click.
ASSERT_LINE=$(grep -nE 'assertRenderedValue[[:space:]]*\(' "$SCENARIO" | head -1 | cut -d: -f1 || true)
if [ -n "${ASSERT_LINE:-}" ]; then
  HEAD_BLOCK=$(head -n "$((ASSERT_LINE - 1))" "$SCENARIO")
  INTERACT_RE='page\.click|page\.fill|page\.keyboard\.press|page\.dblclick|page\.hover|getByRole\([^)]*\)[^.]*\.click|getByLabel\([^)]*\)[^.]*\.click|getByTestId\([^)]*\)[^.]*\.click|getByText\([^)]*\)[^.]*\.click'
  if ! echo "$HEAD_BLOCK" | grep -qE "$INTERACT_RE"; then
    FAILS+=("no real user interaction (click/fill/press/dblclick/hover) before first assertRenderedValue at line $ASSERT_LINE — verify must exercise the app, not assert against an untouched landing page")
  fi
fi

# gate 3: route relevance (best-effort)
# heuristic: parse the first STARTING_URL / page.goto / waitForURL pathname,
# pick its first segment, and check that frontend/src/pages/<segment>/ exists
# and references at least one changed-file basename. limits:
#   - routes whose first segment isn't a directory under frontend/src/pages/
#     are skipped (e.g. nested admin paths the heuristic can't resolve)
#   - if no changed-file list is given, the gate is skipped
# document the heuristic so a human can grant exceptions.
if [ -n "$CHANGED" ] && [ -s "$CHANGED" ]; then
  URL_LINE=$(grep -nE "STARTING_URL|page\.goto|waitForURL" "$SCENARIO" | head -1 || true)
  # strip 'http(s)://host[:port]' so the next grep can pluck '/path' regardless
  # of whether the URL is absolute (page.goto('http://...')) or relative.
  STRIPPED=$(printf '%s\n' "$URL_LINE" | sed -E "s|https?://[^/[:space:]\"'>)]+||g")
  PATHNAME=$(printf '%s\n' "$STRIPPED" | grep -oE "['\"]/[A-Za-z0-9_/-]+|/[A-Za-z0-9][A-Za-z0-9_/-]*" | head -1 | tr -d "'\"" || true)
  SEGMENT=$(printf '%s\n' "$PATHNAME" | cut -d/ -f2)
  if [ -n "${SEGMENT:-}" ] && [ -d "frontend/src/pages/$SEGMENT" ]; then
    HIT=0
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      case "$f" in frontend/*) ;; *) continue ;; esac
      BN=$(basename "$f")
      BN=${BN%.tsx}; BN=${BN%.ts}; BN=${BN%.css}; BN=${BN%.test}
      [ -z "$BN" ] && continue
      if grep -rq -- "$BN" "frontend/src/pages/$SEGMENT/" 2>/dev/null; then
        HIT=1
        break
      fi
    done < "$CHANGED"
    if [ "$HIT" = "0" ]; then
      FAILS+=("scenario lands on '/$SEGMENT/...' but the page module references no changed-file basename — likely wrong route")
    fi
  fi
fi

if [ ${#FAILS[@]} -gt 0 ]; then
  printf 'verify static-lint failed for %s:\n' "$SCENARIO" >&2
  for f in "${FAILS[@]}"; do
    printf -- '- %s\n' "$f" >&2
  done
  exit 1
fi

echo "verify static-lint passed: $SCENARIO"
