#!/usr/bin/env python3
"""rewrite INSTALL.md and README.md inside a staged zephyr-bundle.

these two files reference paths the trim removes (OPERATIONS.md, the docs/specs
spec files, the "richer local seed (gitignored)" workflow). dropping those
links here keeps the shipped docs internally consistent.

fail loudly if an anchor string is missing - that means main has drifted and
the patch needs to be updated to match.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _replace_exact(path: Path, search: str, replace: str) -> None:
    """replace `search` with `replace` in `path`; raise if not found exactly once."""
    text = path.read_text(encoding="utf-8")
    count = text.count(search)
    if count == 0:
        raise SystemExit(
            f"edit-docs: anchor not found in {path}.\n"
            f"main has drifted - update scripts/zephyr-bundle/edit-docs.py.\n"
            f"--- expected anchor ---\n{search}\n--- end ---"
        )
    if count > 1:
        raise SystemExit(
            f"edit-docs: anchor matched {count}x in {path}; refusing ambiguous replace.\n"
            f"--- anchor ---\n{search}\n--- end ---"
        )
    path.write_text(text.replace(search, replace), encoding="utf-8")


def patch_install(install: Path) -> None:
    """strip OPERATIONS.md reference and the maintainer-only seed section."""

    # closed-network callout points at OPERATIONS.md which is trimmed
    _replace_exact(
        install,
        "\n> Closed-network deployments (military airports, restricted-network "
        "aerodromes) replace every external map/terrain endpoint with self-hosted "
        "services — see the **Closed-Network Deployment** section in "
        "[`OPERATIONS.md`](OPERATIONS.md).\n",
        "\n",
    )

    # "richer local seed" workflow is maintainer-only (the .gitignored
    # 01-seed.full.sql does not ship); strip the whole subsection
    _replace_exact(
        install,
        "\n### Optional — using a richer local seed (gitignored)\n\n"
        "Maintainers sometimes keep an extended `db/01-seed.full.sql` outside "
        "the `db/initdb/` mount — a version with additional test airports or "
        "work-in-progress fixtures that should not be published. The file is "
        "gitignored (`db/.gitignore`) so it never lands in the repo. It lives "
        "one level above `db/initdb/` on purpose: postgres' initdb only "
        "auto-runs files inside the `db/initdb/` directory, so a local "
        "maintainer's `db/01-seed.full.sql` does not get loaded by accident. "
        "The `scripts/zephyr-bundle/prepare.sh` flow does pick this richer "
        "file up when present and ships it as the bundle's "
        "`db/initdb/01-seed.sql` — that is intentional, colleagues booting "
        "the bundle should get the demo missions.\n\n"
        "To use it locally, copy it over the committed seed **before** the "
        "first `docker compose up` (postgres only runs initdb scripts on a "
        "fresh volume, so the swap has no effect on an already-initialised "
        "stack):\n\n"
        "```bash\n"
        "docker compose --env-file .env.docker down -v   # wipe the dev volume\n"
        "cp db/01-seed.full.sql db/initdb/01-seed.sql   # locally override; do not commit\n"
        "docker compose --env-file .env.docker up -d\n"
        "```\n\n"
        "To get back to the committed version, run `git checkout "
        "db/initdb/01-seed.sql`.\n",
        "",
    )


def patch_readme(readme: Path) -> None:
    """collapse the docs table to only the docs that actually ship."""

    old_table = """| Doc | Purpose |
|-----|---------|
| **[INSTALL.md](INSTALL.md)** | Install Docker → run → first login. Reviewer-friendly guide, plus a Developer-reference section with env vars, docker cheat sheet, and the local dev workflow. |
| [OPERATIONS.md](OPERATIONS.md) | Runtime ops: backups, restore, elevation provider, AI integration keys, maintenance mode. |
| [CONTEXT.md](CONTEXT.md) | Domain glossary — the canonical vocabulary used across code, issues, and prose. |
| [docs/conventions.md](docs/conventions.md) | Coding conventions, lint / type / test gates, git workflow. |
| [docs/architecture.md](docs/architecture.md) | Architectural notes beyond the system-design chapter. |
| [docs/specs/CHAPTER3-SYSTEM-DESIGN.md](docs/specs/CHAPTER3-SYSTEM-DESIGN.md) | Thesis Chapter 3 — authoritative design reference. |
| [docs/specs/SPEC.md](docs/specs/SPEC.md) | Domain spec: every table, column, enum, and the mission state machine. |
| [docs/specs/WIREFRAME.md](docs/specs/WIREFRAME.md) | Page-by-page wireframes with every field and interaction. |
| [docs/specs/TRAJECTORY-CONTEXT.md](docs/specs/TRAJECTORY-CONTEXT.md) | Trajectory algorithm spec (T3 critical path). |
| [docs/specs/DESIGN-SYSTEM.md](docs/specs/DESIGN-SYSTEM.md) | Frontend design tokens + CSS variables. |
| [docs/specs/MAP-SYMBOLOGY.md](docs/specs/MAP-SYMBOLOGY.md) | Map symbol reference. |
| [docs/audits/](docs/audits/) | Read-only audit reports (primitives sweep, PAPI altitude, DJI WPML spec). |
| [docs/adr/](docs/adr/) | Architectural decision records. |"""

    new_table = """| Doc | Purpose |
|-----|---------|
| **[INSTALL.md](INSTALL.md)** | Install Docker → run → first login. Reviewer-friendly guide, plus a Developer-reference section with env vars, docker cheat sheet, and the local dev workflow. |
| [docs/architecture.md](docs/architecture.md) | Architectural notes complementing the thesis design chapter. |
| [docs/diagrams/](docs/diagrams/) | UML diagrams (PDF + interactive HTML): class, enum, ERD, component, two activity, use case. |"""

    _replace_exact(readme, old_table, new_table)


def main(staging_root: Path) -> None:
    """rewrite INSTALL.md and README.md inside the staging directory."""
    install = staging_root / "INSTALL.md"
    readme = staging_root / "README.md"
    if not install.is_file():
        raise SystemExit(f"edit-docs: missing {install}")
    if not readme.is_file():
        raise SystemExit(f"edit-docs: missing {readme}")
    patch_install(install)
    patch_readme(readme)
    print(f"edit-docs: patched {install.name} and {readme.name}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: edit-docs.py <staging-root>")
    main(Path(sys.argv[1]))
