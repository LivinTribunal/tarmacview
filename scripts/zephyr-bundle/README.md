# zephyr-bundle

Tools for producing a trimmed source-zip of TarmacView to ship to Zephyr colleagues for local Docker deployment.

## Quick use

```bash
bash scripts/zephyr-bundle/prepare.sh
```

Or via Claude Code: say "prepare docker update for zephyr" (triggers the `zephyr-bundle` skill) or run `/zephyr-bundle`.

## What's here

- `prepare.sh` — orchestrator. Trims, copies, patches docs, drops in the seed, zips.
- `trim.txt` — `rsync --exclude-from` manifest. Source of truth for what's removed (Claude artifacts, harnext workflows, internal docs, dev scripts).
- `edit-docs.py` — rewrites `INSTALL.md` / `README.md` to drop links to trimmed paths. Fails loudly if anchors drift on main.

## Flags

| Flag | Effect |
|------|--------|
| `--regenerate` | Run `scripts/regenerate-db-seed.sh` first (~1 min, needs `OPENAIP_API_KEY` for full airport data). |
| `--allow-dirty` | Skip the clean-working-tree check. |
| `--out DIR` | Write to a different output directory (default `./out/`). |

## Output

`out/zephyr-bundle-YYYY-MM-DD.zip` — extracts to a `tarmacview/` directory ready for `./start.sh` or `start.bat`. `.zip` is chosen over `.tar.gz` because Windows Explorer extracts it on double-click without third-party tools.

## When to update `trim.txt`

When a new internal-only path lands on main. The sanity check at the end of `prepare.sh` catches the most common leaks but doesn't know about every path — if a file you don't want shipped appears in the bundle, add a pattern to `trim.txt`.

## When to update `edit-docs.py`

When `INSTALL.md` or `README.md` change in a way that breaks one of the anchor strings. The script fails with the expected anchor printed verbatim — copy the new wording from the source file and update the anchor.
