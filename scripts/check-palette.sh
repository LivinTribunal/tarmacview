#!/usr/bin/env bash
# fail when raw hex literals (#abc, #aabbcc, #aabbccdd) appear in
# components/ or pages/ outside the palette source files. canonical
# colors live in frontend/src/constants/palette.ts and the cesium
# wrapper in frontend/src/components/map/cesium/cesiumColors.ts.
#
# remaining audit-cleanup sites (F-23 through F-28) are listed in
# scripts/check-palette-allowlist.txt and surfaced as warnings until
# they migrate. once empty, the allowlist file can be deleted and
# this script becomes strict.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

ALLOWLIST="$ROOT/scripts/check-palette-allowlist.txt"

# search components and pages for hex literals. comments are stripped
# before the test so issue/PR refs like #525 or #468 in // or /* */ or
# jsdoc lines are not mistaken for colors (a hex inside a comment is
# never a real palette violation anyway).
matches=$(grep -RnE \
  --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  --exclude-dir=__tests__ \
  '#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\b' \
  frontend/src/components frontend/src/pages 2>/dev/null \
  | grep -vE '(palette\.ts|cesiumColors\.ts):' \
  | awk '
      {
        line=$0
        if (match(line, /^[^:]+:[0-9]+:/)) { c=substr(line, RLENGTH+1) } else { c=line }
        t=c; sub(/^[[:space:]]+/, "", t)
        if (t ~ /^\/\// || t ~ /^\/\*/ || t ~ /^\*/) next
        sub(/\/\/.*/, "", c)
        gsub(/\/\*.*\*\//, "", c)
        if (c ~ /#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/) print line
      }' || true)

if [ -z "$matches" ]; then
  echo "palette check: clean"
  exit 0
fi

# split matches into hard-fail (not on allowlist) and warnings (on allowlist)
hard=""
soft=""
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  if [ -f "$ALLOWLIST" ] && grep -qxF "$file" "$ALLOWLIST"; then
    soft+="$line"$'\n'
  else
    hard+="$line"$'\n'
  fi
done <<< "$matches"

if [ -n "$soft" ]; then
  echo "WARNING: pending palette migrations (audit findings F-23 through F-28):"
  echo "$soft"
fi

if [ -n "$hard" ]; then
  echo "ERROR: raw hex literals must move to frontend/src/constants/palette.ts"
  echo "$hard"
  exit 1
fi

exit 0
