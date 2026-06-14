---
name: polish-codebase
description: Run a consistent, reproducible folder-by-folder code-quality polishing sweep over the TarmacView codebase (Python backend + React/TS frontend). Use when the user asks to polish, sweep, clean up, or tidy the codebase, enforce docstring/comment/file-size/naming consistency, prepare for thesis archival, or apply the polishing guidelines. Canonical rulebook for the 11 polishing rules.
---

# Polish Codebase

The canonical rulebook for behavior-neutral code-quality sweeps. Full rule text,
research backing, and edge cases are in [RULES.md](RULES.md). Read it before a sweep.

## Non-negotiables

- **Behavior-neutral.** A sweep never changes behavior. Linters, types, and the
  full test suites are green after every batch (Rule R8). If you cannot prove an
  edit is behavior-neutral, it is not a polish edit.
- **Decomposition is never inline.** Oversized files and risky cross-module
  moves are filed as GitHub Issues (feature template, `refactor` + tier label,
  `harnext:start`, no `agent:plan`) — never split inside the sweep PR (Rule R9).
  The sweep PR stays small. Cross-reference the *Watch-band — deliberately not
  split* section below before filing; items recorded there have been audited
  and tolerated.
- **Detection is tool-proven.** Dead code via knip / compiler / tests, never a
  hand grep (Rule R7 — this exists because a BSD-grep miss already caused a
  regression). Use `scripts/inventory.py`; do not eyeball.
- **Worth-it evaluation before filing a refactor.** Crossing a band is a
  trigger to *consider* a decomposition, not a directive to do one. Bands are
  guidelines, not hard limits — a cohesive 474-line hook is fine; a 700-line
  grab-bag is not. Before filing a decomposition issue (or recording a
  watch-band toleration), explicitly lay out pros and cons in a short table or
  paragraph: the concrete seam (what moves where, parent target size, public
  surface preserved how), the costs (human review attention, browser-verify
  cycle if map/3D, T3 audit if critical path, risk of fighting natural
  cohesion), and the payoff (readability, testability, navigability,
  R1-band-clearance). If the split fights cohesion, the parent only drops by
  ~50–100 lines for a real cost, or the file was just touched and the dust
  hasn't settled, record the decision in the *Watch-band — deliberately not
  split* section below instead. State the verdict explicitly
  ("file" / "skip / watch-band") before any backlog or issue is touched —
  surfacing this judgment to the human gate is cheaper than filing → triaging
  → planning → implementing → reviewing → closing.

## The 11 rules (detail in RULES.md)

| # | Rule | One-line form |
|---|---|---|
| R1 | File length | Python: ok ≤400 / watch 400–600 / decompose >600 / hard >1000. TS/TSX: ok ≤250 / 250–400 / >400 / >700. Trigger for a backlog decision, not an auto-action. |
| R2 | Module docstring | Every non-empty `.py` has a one-line module docstring. Empty `__init__.py` stays empty. TS: exported component/hook/function gets a one-line `/** summary. */` in the **canonical TS form** (above the declaration, never in-body — see RULES.md). |
| R3 | Function docstring | Every `def`/`class` has a one-line, lowercase, period-terminated docstring. Nested closures optional unless non-obvious. TS uses the canonical above-declaration form. |
| R4 | Named constants | Domain-meaning literal → constant on **first** use. Meaningless literal → extract on the **3rd** occurrence. `0/1/-1/""` exempt. One module → module constant; cross-module → shared location (backlog if it touches T3). |
| R5 | Readable names | Intention-revealing; no `data/temp/item/x`. Renames are polish edits **only** when purely local (compiler/tests prove no external importer); public/schema/route/DB renames → backlog. |
| R6 | Comments | Why, not what. Delete restating comments. A "why" comment or section label is allowed anywhere it genuinely aids readability — but peer constructs must match: comment all siblings in a parallel set or none. No lone commented sibling among bare ones. **Forbidden in any comment/docstring/CLAUDE.md: thesis refs, AI markers, and GitHub issue/PR/commit/tracker IDs (`#525`, `PR #540`, commit hashes) — repo unpublished + codebase archived separately, so they dangle like a left-behind TODO. Rewrite the rationale self-contained or delete.** |
| R7 | Tool-proven detection | knip / compiler / tests, never hand grep. |
| R8 | Behavior-neutral gate | ruff + eslint clean; `tsc -b` + `vite build` exit 0; full pytest + vitest green; `structural-tests.sh` exit 0 — after every batch. |
| R9 | No inline decomposition | R1/R5-public hits → file as a GitHub Issue (feature template, `refactor` + tier label, `harnext:start`, no `agent:plan`). Never split in the sweep PR. Watch-band tolerations listed below — check first. |
| R10 | Consistency over preference | When files disagree on a defensible style, match the **majority existing pattern**, not a new invention. |
| R11 | One canonical source | These rules live here. `docs/conventions.md` and `CLAUDE.md` point here; do not fork the rules. |

## Sweep workflow

1. **Inventory.** `python3 .claude/skills/polish-codebase/scripts/inventory.py`
   — pure report, no edits. Read it end to end.
2. **Fix pass, fixed order, one folder per batch:**
   - Backend: `models → schemas → core → utils → services → api`
   - Frontend: `types → constants → utils → hooks → components → pages`
   Apply only R2, R3, R4-local, R5-local, R6, R10. Tick the per-file checklist.
3. **Decomposition-candidate pass.** Every R1 / R5-public / R9 hit → apply the
   worth-it evaluation. If the verdict is "file", open a GitHub Issue with a
   concrete named seam (feature template, `refactor` + tier label,
   `harnext:start`, no `agent:plan`). If "skip / watch-band", add the file to
   the *Watch-band — deliberately not split* section below so future audits
   don't re-litigate.
4. **Gate.** Run R8. Commit the batch only if green; otherwise revert and retry.
5. **Repeat** until every folder in the order is ticked. Decomposition issues
   accumulate independently in GitHub; they are not gated on the sweep
   completing.

## Per-file checklist

For every file touched, all must hold before the batch commits:

- [ ] Module docstring present (R2) — or empty `__init__.py` / TS exempt
- [ ] Every `def`/`class` has a one-line docstring (R3)
- [ ] Domain literals are named constants; no rule-of-three duplication (R4)
- [ ] No `data/temp/item/x`-class names introduced; local renames only (R5)
- [ ] Comments are why-not-what; peer constructs are consistent (R6)
- [ ] No thesis refs, no AI/generation markers, no issue/PR/commit/tracker IDs, dashes not em-dashes (R6)
- [ ] Dead-code removals are knip/compiler/test-proven (R7)
- [ ] Line count recorded; >band ⇒ GitHub Issue filed (or watch-band entry added), not an inline split (R1, R9)
- [ ] Style matches the majority pattern of its peers (R10)

A folder is "done" only when every non-carve-out file in it is ticked.
Carve-outs (never swept): `backend/migrations/**`, `*.test.*`, `*.spec.*`,
`__tests__/**`, `**/locales/*.json`, generated bundles.

## Watch-band — deliberately not split

Files that crossed the watch or decompose band, were audited against the
worth-it rule, and were explicitly tolerated. Future inventory runs will keep
surfacing them; the entries below record *why not* so the decision is not
re-litigated without new information. Re-evaluate only if a file crosses the
hard threshold (Python >1000 / TS >700) or a new seam appears that the prior
analysis missed.

### Backend

- `services/trajectory/helpers.py` (~570) — cohesive pure-helper module; a
  lookups / geometry-transforms seam exists but buys no band benefit at this
  size.
- `services/flight_plan_service.py` (~566) — the one material seam (the AGL
  cluster) was already extracted into a sibling module; the residual is a
  cohesive persistence module.
- `services/airport/lha.py` (~520) — a clean sequence-protocol seam exists but
  the parent only drops to ≈ 410; defer unless the protocol grows.
- `services/airport/surfaces.py` (~427) — the pair-invariant helpers co-evolve
  with the CRUD paths; splitting would scatter one invariant across two files.
- `services/airport/altitude.py` (~423) — intentionally the package's single
  altitude-normalization funnel; splitting fights the design.
- `models/mission.py` (~437) — an aggregate root; peeling business methods off
  it inverts the DDD-lite pattern the codebase deliberately follows.
- `utils/geo.py` (~414) — a clean EGM96-model seam exists and is worth taking
  only when the geoid-library swap it anticipates becomes possible.

### Frontend

- `components/map/hooks/useMapBootstrap.ts` (~474) — bootstrap hook owning
  five `useEffect` blocks + state refs + the helper plumbing they consume.
  One concept; the proposed sibling-module peel buys marginal readability
  while requiring a browser-verify cycle. Cohesion > line-count for this hook.
- `components/map/layers/waypoint/waypointFullLayers.ts` (~465) — already
  barrel-protected against external misuse. Eighteen ids + 15-layer adder +
  filter mutators + remover is a healthy size for one layer module; the next
  peel fights cohesion.
