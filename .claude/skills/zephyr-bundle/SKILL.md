---
name: zephyr-bundle
description: Prepare a trimmed source-zip of the TarmacView codebase with a bundled DB seed, ready to ship to Zephyr colleagues for local Docker deployment. Use when the user says "prepare docker update for zephyr", "build the zephyr bundle", "ship docker to zephyr", "/zephyr-bundle", or similar.
---

# zephyr-bundle

Produces `out/zephyr-bundle-YYYY-MM-DD.zip` — a trimmed source archive Zephyr colleagues extract (double-click on Windows / `unzip` on mac/linux) and run with `./start.sh` or `start.bat`. Internal artifacts (`CLAUDE.md` files, `.claude/`, `harnext-*` workflows, ADRs, audits, thesis specs, dev scripts) are stripped; the bundled `db/initdb/01-seed.sql` auto-loads on the first `docker compose up`.

## When to use

Trigger on the user saying:
- "prepare docker update for zephyr"
- "build the zephyr bundle"
- "ship docker to zephyr"
- "give me a clean tarball for zephyr"
- `/zephyr-bundle`

## What the bundle is

- Trimmed working tree (everything in `scripts/zephyr-bundle/trim.txt` is excluded)
- `docs/specs/diagrams/` relocated to `docs/diagrams/` so the UML survives the spec trim
- `INSTALL.md` and `README.md` rewritten to drop links to trimmed files
- `db/initdb/01-seed.sql` — one of two freshly regenerated seeds (the maintainer picks each run):
  - **demo**: `db/initdb/01-seed.sql` — ephemeral postgres + alembic + python seeder. 5 openaip airports, 9 drones, 2 templates, 3 default users, no demo missions beyond what the seeder bakes in.
  - **full**: `db/01-seed.full.sql` — `pg_dump` of the maintainer's live local DB (container `tarmacview-db`). Includes any demo missions the maintainer has built in the UI on top of the auto-seed. Excludes `audit_log` and `elevation_cache` from the dump.

## How to invoke

```bash
bash scripts/zephyr-bundle/prepare.sh --seed-source=demo   # ship clean auto-seed
bash scripts/zephyr-bundle/prepare.sh --seed-source=full   # ship maintainer DB

# extras
bash scripts/zephyr-bundle/prepare.sh --seed-source=full --allow-dirty
bash scripts/zephyr-bundle/prepare.sh --seed-source=demo --out /tmp/zb
```

Regeneration is always-on. Both seeds are rebuilt every run regardless of which one ships. `--seed-source` is required — there is no implicit default.

The script is the source of truth — read it first if anything is unclear:
- `scripts/zephyr-bundle/prepare.sh` — orchestrator
- `scripts/zephyr-bundle/trim.txt` — rsync exclude manifest
- `scripts/zephyr-bundle/edit-docs.py` — INSTALL.md / README.md rewrite

## Prerequisites

- **Working tree clean.** `git status --short` — if dirty, ask the user whether to commit/stash or pass `--allow-dirty`.
- **`OPENAIP_API_KEY` set in the calling shell.** Required by the demo-seed regen. Source `backend/.env` before invoking: `set -a; source backend/.env; set +a; bash scripts/zephyr-bundle/prepare.sh ...`. Without it, the demo seed ships without airports.
- **Local dev stack running** (`docker compose ps` shows `tarmacview-db` Up healthy). Required by the full-seed dump. If not running, ask the user to run `./start.sh` first.

## Steps to run

1. **Confirm working tree is clean** (`git status --short`).
2. **Confirm `tarmacview-db` container is up** (`docker ps --format '{{.Names}}' | grep -qx tarmacview-db`). If not, ask the user to start it with `./start.sh`.
3. **Ask the user which seed to ship** via `AskUserQuestion`:
   - Option A — `demo`: clean auto-seed, no demo missions
   - Option B — `full`: maintainer DB dump, includes whatever LZIB / demo missions are currently in the maintainer's local DB
4. **Run the script**: `set -a; source backend/.env; set +a; bash scripts/zephyr-bundle/prepare.sh --seed-source=<choice>`.
5. **Report back** with the tarball path, size, seed choice, and the commit SHA the bundle was built from (the script prints all of these).

## If the script fails

- `local DB container 'tarmacview-db' is not running` → ask the user to run `./start.sh`, then re-invoke.
- `anchor not found in INSTALL.md / README.md` → main has drifted. Read the file, find the current text near the failing anchor, and update `scripts/zephyr-bundle/edit-docs.py` to match. Re-run.
- `trimmed paths leaked into the bundle` → a new internal file was added that the trim manifest doesn't cover. Add the pattern to `scripts/zephyr-bundle/trim.txt`. Re-run.
- `OPENAIP_API_KEY is not set` (warning from regen) → demo seed ships with no airports. Source `backend/.env` and re-run if airports matter.

## Maintaining the trim manifest

When new agent or internal-only paths land on main (a new `harnext-*.yml` workflow, a new `docs/audits/` file, a new `CLAUDE.md` in a subdirectory), `trim.txt` may need updating. The sanity check at the end of `prepare.sh` catches the most common leaks. If a leak gets past it, add an explicit path/glob to `trim.txt`.

## Not in scope

This skill does **not**:
- Build or `docker save` images (colleagues build from source on their end — that was the deliberate choice when we set this up; revisit if Zephyr asks for pre-built images)
- Push to GitHub or any registry — the tarball is a local artifact you hand to Zephyr however you want (email, USB, S3, etc.)
- Touch any branch — operates entirely on the current `HEAD` working tree
