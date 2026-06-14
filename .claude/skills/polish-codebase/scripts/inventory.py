#!/usr/bin/env python3
"""inventory pass for the polish-codebase skill: report only, never edits.

Reports, per file: line-count band (R1), missing module docstring (R2),
defs/classes missing docstrings (R3), candidate magic numbers (R4), and
suspicious identifier names (R5). Python files get AST-grade analysis;
TS/TSX files get the line-count band only (no stdlib TS parser - deeper
frontend checks defer to eslint/knip and the per-file checklist).

Usage:
    python3 .claude/skills/polish-codebase/scripts/inventory.py [ROOT ...]

Default roots: backend/app, frontend/src. Always exits 0 - this is a
report, not the R8 gate.
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

# R1 bands: (watch_lo, decompose, hard) physical lines, per language
PY_BANDS = (400, 600, 1000)
TS_BANDS = (250, 400, 700)

# R4 numeric literals that never count as magic
EXEMPT_NUMBERS = {0, 1, 2, -1}

# R5 names that are never acceptable as identifiers
BANNED_NAMES = {
    "data", "temp", "tmp", "item", "val", "x", "arr",
    "obj", "res", "ret", "foo", "bar",
}

# never swept (R1 carve-outs)
SKIP_DIR_PARTS = {
    "migrations", "__tests__", "__pycache__", "node_modules",
    "dist", "build", ".venv", "venv", ".mypy_cache", ".ruff_cache",
}

# fixed sweep order (R-sweep) for grouping the report
SWEEP_ORDER = [
    "models", "schemas", "core", "utils", "services", "api",
    "types", "constants", "hooks", "components", "pages",
]


def band(lines: int, bands: tuple[int, int, int]) -> str:
    """classify a physical line count into an R1 band."""
    watch, decompose, hard = bands
    if lines > hard:
        return "HARD"
    if lines > decompose:
        return "DECOMPOSE"
    if lines > watch:
        return "watch"
    return "ok"


def is_carve_out(path: Path) -> bool:
    """true if the file is an R1 carve-out (never swept, never counted)."""
    name = path.name
    if name.endswith((".test.py", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
        return True
    if ".test." in name or ".spec." in name:
        return True
    parts = set(path.parts)
    if parts & SKIP_DIR_PARTS:
        return True
    if path.suffix == ".json" and "locales" in path.parts:
        return True
    return False


def _parents(tree: ast.AST) -> None:
    """annotate every node with a .parent reference for nesting checks."""
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            child.parent = node  # type: ignore[attr-defined]


def _is_nested_def(node: ast.AST) -> bool:
    """true if a def/class is enclosed by another function (R3 soft case)."""
    cur = getattr(node, "parent", None)
    while cur is not None:
        if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return True
        cur = getattr(cur, "parent", None)
    return False


def _module_constant_value_nodes(tree: ast.Module) -> set[int]:
    """ids of literal nodes that are module-level UPPER_SNAKE constant values (R4 ok)."""
    ok: set[int] = set()
    for stmt in tree.body:
        if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
            if all(isinstance(t, ast.Name) and t.id.isupper() for t in targets):
                if stmt.value is not None:
                    for sub in ast.walk(stmt.value):
                        ok.add(id(sub))
    return ok


def analyze_python(path: Path, text: str) -> dict:
    """run the AST-grade R2/R3/R4/R5 checks on one python file."""
    out: dict = {"module_docstring": True, "missing_docstrings": [],
                 "magic": [], "suspicious": []}
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        out["parse_error"] = f"{exc.lineno}: {exc.msg}"
        return out

    _parents(tree)

    body = [n for n in tree.body if not isinstance(n, ast.Expr)
            or not isinstance(getattr(n, "value", None), ast.Constant)]
    is_empty_init = path.name == "__init__.py" and len(tree.body) == 0
    if not is_empty_init and ast.get_docstring(tree) is None and len(tree.body) > 0:
        out["module_docstring"] = False

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if ast.get_docstring(node) is None:
                kind = "class" if isinstance(node, ast.ClassDef) else "def"
                soft = _is_nested_def(node)
                out["missing_docstrings"].append(
                    (node.lineno, node.name, kind, "soft" if soft else "REQUIRED")
                )

    ok_const = _module_constant_value_nodes(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            if node.value in EXEMPT_NUMBERS or id(node) in ok_const:
                continue
            out["magic"].append((node.lineno, node.value))
        if isinstance(node, ast.arg) and node.arg in BANNED_NAMES:
            out["suspicious"].append((node.lineno, node.arg))
        if (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
                and node.id in BANNED_NAMES):
            out["suspicious"].append((node.lineno, node.id))
    return out


import re

# an exported declaration that should carry a canonical above-decl docstring
_TS_EXPORT_DECL = re.compile(
    r"^export\s+(?:default\s+)?(?:async\s+)?function\s+\w+"
    r"|^export\s+default\s+function\b"
    r"|^export\s+const\s+\w+\s*(?::[^=]+)?=\s*"
    r"(?:async\s*)?(?:\(|function\b|forwardRef\b|memo\b|\w+\s*=>)"
)
# single-line /** summary. */ with the canonical single inner spaces
_TS_GOOD_ONELINE = re.compile(r"^/\*\* .+ \*/$")
_TS_NOSPACE = re.compile(r"^/\*\*[^ ].*\*/$|^/\*\*.*[^ ]\*/$")


def analyze_ts(text: str) -> dict:
    """detect canonical-TS-docstring-placement violations on exported symbols."""
    out: dict = {"ts": True, "inbody": [], "nospace": [],
                 "linecomment": [], "missing": []}
    src = text.split("\n")
    for i, raw in enumerate(src):
        line = raw.strip()
        if not _TS_EXPORT_DECL.match(line):
            continue

        # preceding non-blank line
        j = i - 1
        while j >= 0 and not src[j].strip():
            j -= 1
        prev = src[j].strip() if j >= 0 else ""

        if prev.endswith("*/"):
            # there is a block comment directly above the declaration
            start = j
            while start >= 0 and not src[start].strip().startswith("/**"):
                start -= 1
            if start >= 0:
                block = " ".join(s.strip() for s in src[start:j + 1])
                if start == j and not _TS_GOOD_ONELINE.match(prev) \
                        and _TS_NOSPACE.match(prev):
                    out["nospace"].append((i + 1, line[:48]))
                # multi-line /** ... */ above is acceptable placement
                _ = block
            continue
        if prev.startswith("//"):
            out["linecomment"].append((i + 1, line[:48]))
            continue

        # no doc above - look for an in-body first-statement /** */
        depth_open = None
        for k in range(i, min(i + 6, len(src))):
            if "{" in src[k]:
                depth_open = k
                break
        if depth_open is not None:
            for k in range(depth_open + 1, min(depth_open + 4, len(src))):
                s = src[k].strip()
                if not s:
                    continue
                if s.startswith("/**"):
                    out["inbody"].append((k + 1, line[:48]))
                break
            else:
                out["missing"].append((i + 1, line[:48]))
        else:
            out["missing"].append((i + 1, line[:48]))
    return out


# tracker-reference patterns forbidden in comments/docstrings/CLAUDE.md (R6)
_TRACKER = re.compile(
    r"(?<![0-9A-Fa-f])#\d{1,6}\b"           # #525 issue/PR (not a hex colour)
    r"|\bPR\s*#?\d+"                          # PR 540 / PR#540
    r"|\bissues?\s+#?\d+"                     # issue 449
    r"|\bpull request\b"
    r"|\b(?:commit|revision|rev|sha)\b[^\n]{0,24}?\b[0-9a-f]{7,40}\b"
)


def scan_trackers(text: str, suffix: str) -> list[tuple[int, str]]:
    """report comment/docstring lines that cite a tracker id (R6 forbidden)."""
    hits: list[tuple[int, str]] = []
    in_pydoc = False
    for n, raw in enumerate(text.split("\n"), 1):
        line = raw.rstrip()
        is_comment = False
        if suffix == ".py":
            q = line.count('"""') + line.count("'''")
            if in_pydoc or line.lstrip().startswith("#") or " #" in line or q:
                is_comment = True
            if q % 2 == 1:
                in_pydoc = not in_pydoc
        elif suffix in (".ts", ".tsx"):
            s = line.lstrip()
            if (s.startswith(("//", "/*", "*", "/**")) or "//" in line
                    or "/*" in line or "*/" in line):
                is_comment = True
        elif suffix == ".md":
            is_comment = True
        if is_comment and _TRACKER.search(line):
            hits.append((n, line.strip()[:90]))
    return hits


def group_key(path: Path) -> str:
    """bucket a file under the first sweep-order folder in its path."""
    for part in path.parts:
        if part in SWEEP_ORDER:
            return part
    return "other"


def main(argv: list[str]) -> int:
    """walk the roots, print the inventory report, always exit 0."""
    repo = Path(__file__).resolve().parents[4]
    roots = [Path(a).resolve() for a in argv[1:]] or [
        repo / "backend" / "app", repo / "frontend" / "src"
    ]

    rows: list[tuple] = []
    track: list[tuple[str, int, str]] = []
    for root in roots:
        if not root.exists():
            print(f"!! root not found: {root}")
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_PARTS]
            for fn in sorted(filenames):
                p = Path(dirpath) / fn
                if p.name == "CLAUDE.md":
                    md = p.read_text(encoding="utf-8", errors="replace")
                    for ln, snip in scan_trackers(md, ".md"):
                        track.append((str(p.relative_to(repo)), ln, snip))
                    continue
                if p.suffix not in (".py", ".ts", ".tsx"):
                    continue
                if is_carve_out(p):
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
                for ln, snip in scan_trackers(text, p.suffix):
                    track.append((str(p.relative_to(repo)), ln, snip))
                lines = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
                rel = p.relative_to(repo)
                if p.suffix == ".py":
                    a = analyze_python(p, text)
                    rows.append((group_key(p), rel, lines,
                                 band(lines, PY_BANDS), a))
                else:
                    rows.append((group_key(p), rel, lines,
                                 band(lines, TS_BANDS), analyze_ts(text)))

    order = {name: i for i, name in enumerate(SWEEP_ORDER)}
    rows.sort(key=lambda r: (order.get(r[0], 99), str(r[1])))

    n_size = n_mod = n_doc = n_magic = n_name = 0
    n_tsbody = n_tsns = n_tslc = n_tsmiss = 0
    print("=" * 78)
    print(" polish-codebase inventory  (report only - not the R8 gate)")
    print("=" * 78)

    cur = None
    for grp, rel, lines, bnd, a in rows:
        if grp != cur:
            cur = grp
            print(f"\n--- {grp} ---")
        flags = []
        if bnd != "ok":
            flags.append(f"R1:{bnd}({lines})")
            if bnd in ("DECOMPOSE", "HARD"):
                n_size += 1
        if a is not None and a.get("ts"):
            if a["inbody"]:
                flags.append(f"TS:inbody({len(a['inbody'])})")
                n_tsbody += len(a["inbody"])
            if a["nospace"]:
                flags.append(f"TS:nospace({len(a['nospace'])})")
                n_tsns += len(a["nospace"])
            if a["linecomment"]:
                flags.append(f"TS:linecomment({len(a['linecomment'])})")
                n_tslc += len(a["linecomment"])
            if a["missing"]:
                flags.append(f"TS:missing({len(a['missing'])})")
                n_tsmiss += len(a["missing"])
        elif a is not None:
            if a.get("parse_error"):
                flags.append(f"PARSE_ERR:{a['parse_error']}")
            if not a["module_docstring"]:
                flags.append("R2:no-module-docstring")
                n_mod += 1
            req = [m for m in a["missing_docstrings"] if m[3] == "REQUIRED"]
            soft = [m for m in a["missing_docstrings"] if m[3] == "soft"]
            if req:
                flags.append(f"R3:{len(req)}-missing-docstring")
                n_doc += len(req)
            if soft:
                flags.append(f"R3:{len(soft)}-nested-soft")
            if a["magic"]:
                flags.append(f"R4:{len(a['magic'])}-magic?")
                n_magic += len(a["magic"])
            if a["suspicious"]:
                flags.append(f"R5:{len(a['suspicious'])}-name?")
                n_name += len(a["suspicious"])
        status = "  ".join(flags) if flags else "ok"
        print(f"  {str(rel):<60} {lines:>5}  {status}")

    print("\n" + "=" * 78)
    print(f" actionable: {n_size} files >band (R1->backlog)  "
          f"{n_mod} no module docstring (R2)  "
          f"{n_doc} defs missing docstring (R3)")
    print(f" ts-docstring: {n_tsbody} in-body  {n_tsns} no-space  "
          f"{n_tslc} line-comment  (R2/R3 canonical-form violations -> normalize)")
    print(f" advisory:   {n_magic} magic-number candidates (R4)  "
          f"{n_name} suspicious names (R5)  {n_tsmiss} ts exported w/o doc - human-judge each")
    print(f" trackers:   {len(track)} forbidden issue/PR/commit refs in "
          f"comments/docstrings/CLAUDE.md (R6 - remove, rewrite self-contained)")
    print("=" * 78)
    print(" R4/R5 + ts-missing are heuristic hints, not auto-fixes. R1>band")
    print(" never gets split inline (R9) - file a GitHub Issue or add to the")
    print(" Watch-band section of SKILL.md.")

    if track:
        print("\n" + "=" * 78)
        print(" TRACKER REFERENCES (R6 forbidden - worklist)")
        print("=" * 78)
        for fp, ln, snip in sorted(track):
            print(f"  {fp}:{ln}: {snip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
