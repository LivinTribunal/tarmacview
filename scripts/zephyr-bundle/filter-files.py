#!/usr/bin/env python3
"""filter `git ls-files` output against the trim manifest.

reads paths on stdin (one per line, as `git ls-files` produces), drops any
path that matches a pattern in scripts/zephyr-bundle/trim.txt, writes the
survivors to stdout. used by prepare.sh to assemble the rsync --files-from
list.

trim.txt uses rsync's --exclude-from grammar:
- leading `#` and blank lines are comments
- trailing `/` means directory-only (we treat it as "path or any descendant")
- a leading `/` anchors to the source root (rsync's transfer root)
- no leading `/` means basename match in any directory
- otherwise it's a path glob anchored at the root

we deliberately implement only the subset we use, not full rsync semantics.
"""

from __future__ import annotations

import fnmatch
import sys
from pathlib import Path


def _load_patterns(manifest: Path) -> list[tuple[str, bool, bool]]:
    """return list of (pattern, dir_only, anchored) tuples from the manifest."""
    patterns: list[tuple[str, bool, bool]] = []
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        dir_only = line.endswith("/")
        if dir_only:
            line = line.rstrip("/")
        anchored = line.startswith("/") or "/" in line
        if line.startswith("/"):
            line = line[1:]
        patterns.append((line, dir_only, anchored))
    return patterns


def _matches(path: str, pattern: str, dir_only: bool, anchored: bool) -> bool:
    """true if `path` (a tracked file) is excluded by this single pattern."""
    if anchored:
        # path or any ancestor must match the pattern as a whole path-glob
        parts = path.split("/")
        for i in range(1, len(parts) + 1):
            prefix = "/".join(parts[:i])
            if fnmatch.fnmatchcase(prefix, pattern):
                # dir_only patterns must match a directory, not a leaf file -
                # for a leaf, that means an ancestor segment matched (i < len)
                if dir_only and i == len(parts):
                    continue
                return True
        return False

    # basename match in any directory
    name = pattern
    for segment in path.split("/")[:-1]:
        if fnmatch.fnmatchcase(segment, name):
            return True
    if not dir_only and fnmatch.fnmatchcase(Path(path).name, name):
        return True
    return False


def is_excluded(path: str, patterns: list[tuple[str, bool, bool]]) -> bool:
    """true if any pattern in the manifest excludes this path."""
    return any(_matches(path, p, d, a) for p, d, a in patterns)


def main() -> None:
    """read tracked paths on stdin, print survivors to stdout."""
    if len(sys.argv) != 2:
        raise SystemExit("usage: filter-files.py <trim.txt>")
    patterns = _load_patterns(Path(sys.argv[1]))
    for line in sys.stdin:
        path = line.rstrip("\n")
        if not path:
            continue
        if not is_excluded(path, patterns):
            print(path)


if __name__ == "__main__":
    main()
