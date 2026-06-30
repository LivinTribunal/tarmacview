# Repo-wide unsloppification audit — 2026-06-30

A whole-repo dedup + antispaghetti sweep of production code (`backend/app/**`
non-vendored, `frontend/src/**` non-test). Mechanical baseline (jscpd / vulture /
knip / ts-prune / arch-lint) feeding a 29-slice ponytail+grain agent fan-out,
synthesized into a themed register. Method: Phase-0 tool evidence → 29 parallel
per-slice audits → dedupe/rank synthesis. 131 raw findings → 16 themes.

Scope-excluded and unchanged: vendored `video_processing/`, `*.test.*`, `docs/`,
`scripts/`, migrations, and the protected files (`requirements.txt`,
`package-lock.json`, `.github/workflows/**`, `harness.config.json`).

## Mechanical baseline

| Signal | Tool | Result |
|---|---|---|
| Duplication | jscpd | 229 clones / 2,834 dup lines (2.63%): tsx 3.55%, ts 3.12%, py 1.45% |
| Dead Python | vulture | ~clean (only `__exit__` protocol args, false positives) |
| Dead files | knip | none (only `playwright.config.ts`, false positive) |
| Unused exports | ts-prune | 27 real candidates (after dropping barrel/type false positives) |
| Layer boundaries | lint-architecture.ts | 8 `schema→core` — **all false positives**, see below |
| Lint baseline | ruff / eslint | clean (0 / 0) |

**Duplication dominates; dead code is negligible.**

### The 8 `schema→core` "violations" are a config bug, not code debt

`lint-architecture-config.json` forbids `schemas → core` (allowed: none), but
`backend/app/schemas/CLAUDE.md` and the `DJI_WPML_ENUMS` invariant explicitly
document `app.core.constants` / `enums` / `geometry` imports from schemas as
intentional ("the constants table import is intentional"; the constant lives in
`core` so `DroneProfileResponse.supports_dji_wpml` can read it "without crossing
the schemas → services layer"). The config is stricter than policy and CI does
not even run this checker (it runs the grep-based `scripts/structural-tests.sh`).
**Fix: reconcile the config to allow `schemas → core`** — do not "fix" the code.

## Why this exists (root cause)

1. **Inherited seed debt.** Every major duplication cluster
   (`DroneListTable`↔`OperatorDroneTable` 71L, the coordinator/operator twin
   pages, `useDrawCircle`↔`Rectangle`↔`Polygon`) traces to a single commit:
   `4c7c476 "seed tarmacview from drone mission planning module as the merge
   base"`. It predates the harnext pipeline and its review — it was never
   diff-reviewed.
2. **Parallel vertical slices without extraction.** `operator-center` and
   `coordinator-center` were built as separate feature areas; the second center's
   table/page/panel was cloned from the first instead of a shared component being
   extracted.
3. **Copy-paste specialization of variants.** Draw-tool hooks, the results chart
   pair, the info cards, and the AGL/obstacle/safety panels were each forked from
   a first implementation rather than parameterized.
4. **One documented-invariant regression slipped back in.** `flight_plan_agl.py`
   reintroduced the per-service `_extract_coords` / `_extract_altitude` shims with
   the `(0,0,0)` Null-Island fallback that the services CLAUDE.md explicitly bans
   (theme #16) — a diff-scoped reviewer didn't catch a banned pattern reappearing
   in a new file.

### Why it persists (gate gaps)

- **Diff-scoped review can't see inherited or cross-file debt.** The pipeline's
  `harnext-review.yml` already runs both ponytail and grain lenses, but by design
  only blocks divergences *a PR introduces*; "pre-existing ones it merely sits
  next to are noted, not blocked." So none of the seed debt is ever actioned.
- **No repo-wide periodic sweep.** No `schedule:`/`cron:` job exists — debt is
  only seen if a PR happens to touch it.
- **No mechanical dedup metric.** jscpd is nowhere in CI; copy-paste growth is
  invisible and uncapped.
- **Reuse guidance is generic.** `harnext-implement.yml` has solid ponytail
  "lazy senior dev" rungs + "read existing code", but nothing names the specific
  reuse targets or the operator↔coordinator twinning, so an agent building "the
  coordinator version" won't necessarily discover the operator sibling to share.

## Prevention wiring

### Editable (skills / docs / memory) — applied with this audit

- **grain-review skill**: added a *twin/reuse preflight* — before a clean verdict,
  grep the *other* center (`operator-center`↔`coordinator-center`), `common/`, and
  `hooks/` for a sibling; named the known duplication families; and a note to
  assemble dedup from a repo-wide jscpd clone map, not just the diff.
- **This doc** records the duplication families so humans and agents know
  "operator & coordinator share components — don't fork them."

### Proposed (protected `.github/workflows/**`, `harness.config.json`, lockfiles — need a human)

- **jscpd dedup gate in `ci.yml`** (run via `npx`, no committed dep): warn/block
  when a PR raises the duplication % above the 2.63% baseline.
- **Scheduled monthly repo-wide sweep** (this audit's workflow) — the only thing
  that can catch inherited + cross-file debt, which diff-review structurally cannot.
- **Name the reuse targets + twin families in `harnext-implement.yml`** reuse
  guidance.
- **Reconcile `lint-architecture-config.json`** to allow `schemas → core`, and
  decide whether CI should run the richer `lint-architecture.ts` (currently only
  the grep-based `structural-tests.sh` runs).

## The register — 16 themes

Ranked; T3 needs manual human review. Each fix aligns to an **existing** exemplar
(no new abstractions). Deletions gated on tool-clean + suite green before/after;
behavioral refactors need a characterization test green on both halves.

| # | Kind | Tier | Theme | Headline |
|---|---|---|---|---|
| 1 | convention | T2 | Replace hand-rolled SVG spinners with lucide `Loader2` | 6 sites, 2 conventions coexist |
| 2 | dead-code | T2 | Sweep ts-prune/knip-confirmed dead FE exports + `Partial<>`-able types | 22 findings, tool-backed |
| 3 | convention | T2 | Restore service→audit→commit invariant on bulk/self-update/delete routes | audit-trail gaps |
| 4 | dedup | T2 | Consolidate backend helpers + remove dead shims/aliases | `111320` ×3, `enum_check_values`, `math.hypot` |
| 5 | dedup | T2 | Route results tables/charts through existing `VerdictBadge`/`ChartShell` | bypassed exemplars |
| 6 | dedup | T2 | Dedup map-layer helpers + **fix `hover_duration` waypoint divergence (latent bug)** | `syncLayerVisibility` ×3 |
| 7 | dedup | T2 | Unify coordinator/operator twin pages: DroneTable, AirportTable, drone detail/filter | 71L/66L/45L clones |
| 8 | dedup | T2 | Extract shared UI primitives: collapsible header, 2D/3D toggle, chevron, info card, toast | 13 findings |
| 9 | dedup | T2 | Extract `useToast` + shared geometry/file utils duplicated across hooks | toast pattern ×8 |
| 10 | dedup | T2 | Unify coordinator/operator map toolbars + help panel via existing variants | `MapHelpPanel` has a `variant` prop already |
| 11 | convention | T2 | FE style-convention sweep: inline styles, raw buttons, double writes, naming | 7 findings |
| 12 | dedup | T2 | Dedup mission config/validation page + form blocks | `MethodSpecificSections` ×2, 37L |
| 13 | dedup | T2 | Collapse the draw-tool hook family into a shared base hook | useDraw* 4-way clone |
| 14 | layer | T2 | Move misplaced domain logic out of routes + align `response_model` conventions | admin/terrain routes |
| 15 | decompose | T2 | Remove measurement ports-and-adapters layer + decompose the 841-line service | only entity using domain/+infra/ |
| 16 | dedup | **T3** | Consolidate trajectory/flight_plan geometry seams onto `point_lonlatalt` (no Null Island) | **reintroduced banned shims** |

Full per-theme detail (locations, fix approach, deletion-safety) is in the
synthesis register produced by the audit workflow; each theme maps to one
GitHub issue = one branch.
