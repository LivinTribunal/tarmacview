#!/usr/bin/env bash
# Fail if backend/migrations/versions has more than one head revision.
#
# Multi-heads happen when two PRs each add a migration in parallel and both
# land on main without a merge revision joining them. Once it lands, every
# `alembic upgrade head` blows up. This guard catches it before merge.
#
# Pure-python parse of revision/down_revision fields - no alembic, no DB,
# no backend deps needed.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d backend/migrations/versions ]]; then
  echo "check-alembic-heads: backend/migrations/versions not found" >&2
  exit 1
fi

python3 - <<'PY'
import ast
import pathlib
import re
import sys


VERSIONS = pathlib.Path("backend/migrations/versions")


def extract(path: pathlib.Path) -> tuple[str, tuple[str, ...]]:
    """return (revision, down_revisions tuple) parsed from a migration file."""
    tree = ast.parse(path.read_text())
    revision: str | None = None
    down: tuple[str, ...] = ()
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        target = node.targets[0] if isinstance(node, ast.Assign) else node.target
        if not isinstance(target, ast.Name):
            continue
        value = node.value
        if value is None:
            continue
        if target.id == "revision" and isinstance(value, ast.Constant):
            revision = value.value
        elif target.id == "down_revision":
            if isinstance(value, ast.Constant):
                if value.value is None:
                    down = ()
                else:
                    down = (value.value,)
            elif isinstance(value, (ast.Tuple, ast.List)):
                down = tuple(
                    elt.value for elt in value.elts
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                )
    if revision is None:
        raise RuntimeError(f"{path}: no revision identifier")
    return revision, down


revisions: dict[str, tuple[str, ...]] = {}
for f in sorted(VERSIONS.glob("*.py")):
    if f.name.startswith("_"):
        continue
    rev, down = extract(f)
    revisions[rev] = down

referenced: set[str] = set()
for downs in revisions.values():
    referenced.update(downs)

heads = sorted(rev for rev in revisions if rev not in referenced)

if len(heads) == 1:
    print(f"alembic heads: single head ✓  ({heads[0]})")
    sys.exit(0)

print(f"alembic heads: expected 1, found {len(heads)}", file=sys.stderr)
print("", file=sys.stderr)
for h in heads:
    print(f"  {h}", file=sys.stderr)
print("", file=sys.stderr)
print("fix: generate a merge revision with", file=sys.stderr)
print("  cd backend && alembic merge -m 'merge <a> and <b> heads' <rev_a> <rev_b>", file=sys.stderr)
sys.exit(1)
PY
