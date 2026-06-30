---
name: grain-review
description: >
  Review a diff or PR for structural consistency and spaghetti — NOT for line
  count. The counterpart to ponytail-review: where ponytail-review hunts
  over-engineering ("what can we cut"), grain-review hunts divergence from
  TarmacView's existing structure ("does this match how we already do it"). Finds
  code that reinvents an existing helper, ignores the routes/services/models/schemas
  layout, crosses a forbidden layer boundary, mutates an aggregate's children
  instead of going through the aggregate root, or introduces a second convention
  for something already done one way. One line per finding: location, what
  diverges, the existing exemplar to align to. Use when reviewing a PR/diff for
  spaghetti, inconsistency, duplication, or "does this follow our patterns".
  Triggers: "/grain-review", "grain review", "review for spaghetti", "is this
  consistent with our patterns", "structural review", "does this follow existing
  structure".
license: MIT
---

# Grain Review

Review a diff for one question only: **does this code go with the grain of what
already exists in TarmacView, or does it invent a second way to do something
already done?** The best outcome is not a shorter diff — it's a diff
indistinguishable from the code already in those files.

This is the structural sibling of `ponytail-review`. The two reviews answer
different questions and can disagree — see *Consistency beats cuts* below.

## What it hunts

For each finding, name the **existing exemplar** the code should have followed.
A finding without a "here's the pattern you already have" pointer is just an
opinion — don't emit it.

- `diverge:` does the same kind of thing as a sibling, but shaped differently
  (naming, DI style, file layout, error/response type). → name the dominant
  sibling pattern + an exemplar path. TarmacView naming grain: `snake_case`
  files/functions, `PascalCase` classes; Pydantic DTOs are `{Entity}Create` /
  `{Entity}Update` / `{Entity}Response`; routes are `/api/v1/{resource}`;
  frontend components `PascalCase.tsx`, utilities `camelCase.ts`.
- `duplicate:` re-implements a helper/component/service/util/value-object that
  already exists. → name the existing one to call instead. Common reinvented
  things here: geometry WKT conversion (`app.core.geometry`), value objects
  (`app/models/value_objects.py`: `Coordinate`, `Speed`, `AltitudeRange`,
  `IcaoCode`), audit logging (`app.utils.audit.log_audit`), shared frontend
  primitives (`components/common/`), constants in `frontend/src/constants/`,
  hooks in `frontend/src/hooks/`.
- `layer:` import crosses a forbidden boundary. The allowed-import matrix is
  enforced by `scripts/lint-architecture.ts` (config:
  `scripts/lint-architecture-config.json`) and mirrored in
  `harness.config.json` → `architecturalBoundaries`. → name the layer it should
  route through. The boundaries (also in `docs/layers.md`):
  - `api/routes/` → may import `services`, `schemas`, `core`. **Never `models`**
    (routes never query the DB directly).
  - `services/` → may import `models`, `schemas`, `core`, `utils`. **Never `routes`**.
  - `models/` → may import `core` only.
  - `schemas/` → may import `core` only (and stdlib/pydantic).
  - `core/` → imports nothing from the app layers above.
  - `value_objects.py` is pure Python: **no `sqlalchemy`, no `fastapi`**.
  - Escape hatch: a line carrying an `arch-exempt` comment is intentionally
    waived — do not flag it.
- `misplaced:` right code, wrong folder for its kind. → where it belongs.
  Backend: HTTP concerns in `api/routes/`, business logic in `services/` or on
  the model (see DDD-Lite below), ORM in `models/`, DTOs in `schemas/`. Frontend:
  the `components/` taxonomy — `common/`, `mission/`, `map/{layers,overlays,cesium}/`,
  `coordinator/`, `drone/`, `admin/`, `Layout/`, `Auth/`; page-level under `pages/`.
- `reach-in:` mutates an aggregate's children or status directly instead of
  going through the **aggregate root** method. → name the method. TarmacView's
  DDD-Lite aggregates:
  - **Mission** owns inspections + status. Use `mission.add_inspection()` /
    `mission.remove_inspection()` / `mission.transition_to(status)` — never
    assign `mission.status =` or append to the inspection collection directly.
  - **Airport** owns surfaces/obstacles/safety-zones. Use `airport.add_surface()`
    / `add_obstacle()` / `add_safety_zone()`.
- `inconsistent:` introduces a *second* convention for an operation the codebase
  already does one way (two ways to change mission status, a raw `float`
  altitude where siblings pass an `AltitudeRange`, a hardcoded JSX string where
  siblings use `t()`, a literal hex color where siblings use a `--tv-*` variable).
  → which convention is dominant, align to it.
- `chain:` skips a hop the canonical request path uses — e.g. a route that runs
  `db.query(Model)` itself or holds business logic, instead of
  `route → service function → model`. → name the canonical chain + exemplar.

## Format

`<file>:L<line>: <tag> <what diverges>. follows: <existing pattern @ exemplar path>.`

## Examples

✅ `routes/measurements.py:L40: layer: route imports app.models.measurement and queries it directly. follows: route → service function like camera_presets.py:L31 calling camera_preset_service.list_presets(db, ...).`

✅ `mission_service.py:L88: reach-in: sets mission.status = "VALIDATED" directly. follows: mission.transition_to(MissionStatus.VALIDATED) — the state machine on the Mission aggregate.`

✅ `flight_plan_service.py:L12: duplicate: hand-rolled "POINT Z (...)" string building. follows: app.core.geometry (to_wkt / the Coordinate value object).`

✅ `useWaypointList.ts:L8: duplicate: re-derives the palette hex inline. follows: frontend/src/constants/palette.ts — import the token.`

✅ `MissionPanel.tsx:L52: diverge: hardcoded "Save mission" string in JSX. follows: react-i18next t() like every sibling component; add the key under the page namespace in i18n/locales.`

✅ `schemas/drone_profile.py:L20: diverge: response model named DroneProfileOut. follows: {Entity}Response naming, e.g. CameraPresetResponse.`

## Canonical exemplar

The reference slice for a backend resource is **`camera_presets`**:
`backend/app/api/routes/camera_presets.py` (thin route: `Depends(get_db)` + an
auth dependency like `OperatorUser`, calls a service-module function, returns a
schema, no ORM) → `backend/app/services/camera_preset_service.py` (module-level
functions taking `db` first, owning the query + business logic). Service logic
is plain module functions called as `camera_preset_service.list_presets(db, ...)`
— there is **no** controller layer and no injected service class. Check a changed
backend slice against this, not just against its file-local neighbors.

## Twin / reuse preflight (do this before any "goes with the grain" verdict)

The 2026-06-30 unsloppify audit (`docs/audits/2026-06-30-unsloppify-audit.md`)
found the dominant debt is **cross-file duplication a diff-scoped review never
sees** — a new file that clones a sibling in a file the PR doesn't touch. Before
clearing a new component / hook / page / service, actively look for the sibling
it should share with, not just at the lines in the diff:

- **operator ↔ coordinator twins.** `operator-center` and `coordinator-center`
  were built by cloning each other. A new `coordinator/*` or `operator/*` thing
  almost always has a twin in the other center — grep the other center first.
  Known clone families: `DroneListTable`/`OperatorDroneTable`, the airport tables
  (`AirportListPage`/`AirportSelectionView`), drone detail/list pages, the map
  toolbars (`MapDrawingToolbar`/`MapControlsToolbar`), help panels
  (`CoordinatorMapHelpPanel` — `MapHelpPanel` already has a `variant` prop for this).
- **variant forks.** Draw-tool hooks (`useDrawCircle`/`Rectangle`/`Polygon`/
  `usePlacePoint`), results charts, info cards, and the AGL/obstacle/safety-zone
  overlay panels are forked-then-specialized. A new one of these should extend the
  base, not copy a sibling.
- **named reuse targets.** Spinners → lucide `Loader2` (not a hand-rolled
  `<svg animate-spin>`); verdict pills → `VerdictBadge`; chart shells →
  `ChartShell`; toast → the `useToast` pattern; WKT→tuple → `point_lonlatalt`
  (never a per-service `_extract_coords` / `(0,0,0)` Null-Island shim — that exact
  pattern is banned and regressed once); enum CHECK SQL → `enum_check_values`;
  the meters-per-degree constant lives in `app.core.constants`.

Emit a `duplicate:` finding when a diff clones one of these instead of reusing it.
And read from the **repo-wide jscpd clone map**, not only the diff — a clone has
two ends and the PR may only touch one.

## Note on the layers.md / DDD-Lite tension

`docs/layers.md` lists "model methods" as an anti-pattern (anemic-model stance),
but the root `CLAUDE.md` *DDD-Lite Patterns* section and the actual code put
business logic **on** the aggregate roots (`Mission.transition_to`,
`Mission.add_inspection`, `Airport.add_surface`, value-object methods). When the
two disagree, **CLAUDE.md + the code that demonstrably exists win** — a
`mission.transition_to()` call is the grain, not a layer violation. Do not flag
business methods on `Mission`/`Airport`/value objects by citing layers.md.

## Consistency beats cuts

This is where grain-review and ponytail-review **diverge on purpose**:

- ponytail-review says: *thin wrapper with one caller → inline it, −13 lines.*
- grain-review says: *if that wrapper matches a row of sibling wrappers in the
  same module, it is the grain — keeping it is correct, inlining it creates an
  inconsistency.* A line you delete that breaks an established local convention
  is a regression dressed as a cleanup.

Rule: **for shared or convention-bearing code, consistency wins over brevity.**
For genuinely novel one-off code with no sibling, ponytail's minimalism wins.
When a ponytail-review "cut" would diverge from a local pattern, grain-review
overrules it and says `keep: matches <N> siblings @ <path>`.

## Altitude — compare to the canonical exemplar, not just the neighbors

The trap: you check the changed code against the other functions in the *same
file*, see they match, and call it clean. But a whole slice can be uniformly
diverged. "Matches its 5 sibling routes" hides "all 6 query the DB directly
instead of going through a service." Before any "goes with the grain" verdict:

1. Identify the **canonical exemplar** for this kind of slice (`camera_presets`
   for a backend resource) and its full call chain.
2. Check the changed code against *that*, not only against its file-local
   neighbors.
3. If the slice diverges as a whole, say so — distinguish **local grain** (it
   matches its siblings) from **repo grain** (the siblings themselves diverge
   from the canonical chain). Both are findings; only the second is the deeper
   one. A new line that merely conforms to a diverged slice is `local-ok` but
   inherits the slice's `chain:`/`diverge:` debt — name it.

## Verdict

End with the structural metric, never a line count:

- Clean: `Goes with the grain — checked against the canonical exemplar (camera_presets), not just file-local siblings. <N> changes, all match. Ship.`
- Findings: `<N> divergences from house style (<M> introduced by this PR, rest pre-existing; <K> are slice-wide vs the canonical chain).`

Distinguish divergences this PR *introduces* from pre-existing ones it merely
sits next to — only the introduced ones should block — and distinguish
file-local consistency from repo-canonical consistency (Altitude above). Never
emit "matches its siblings → ship" without having compared the siblings to the
canonical exemplar first.

## Boundaries

- Scope: **structure, placement, reuse, layer boundaries** only. Correctness,
  security, and performance → normal review (`/code-review` or `review-proof`).
  Line-count / over-engineering → `ponytail-review` (and grain-review overrules
  its cuts when they break a local convention).
- Source of truth for the rules it points at: `harness.config.json`
  (`architecturalBoundaries`), `scripts/lint-architecture-config.json`,
  `docs/layers.md`, `docs/architecture.md`, `docs/conventions.md`, the root and
  per-package `CLAUDE.md` files (DDD-Lite section + `api/routes/CLAUDE.md`,
  `services/CLAUDE.md`), and `CONTEXT.md` for domain language. Reads and reports
  only — applies nothing.
- "stop grain-review" / "normal mode" to revert.
