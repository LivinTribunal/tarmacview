#!/usr/bin/env bash
# fail when super-admin pages call setError("...") with a literal english
# string. all user-facing strings should flow through t() so the page
# remains translatable.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

matches=$(grep -RnE 'setError\("[A-Z]' frontend/src/pages/super-admin 2>/dev/null || true)

if [ -n "$matches" ]; then
  echo "ERROR: hardcoded setError strings in super-admin pages:"
  echo "$matches"
  echo ""
  echo "Wrap with t(\"superAdmin.errors.<key>\") and add the key to en.json."
  exit 1
fi

echo "super-admin string check: clean"
