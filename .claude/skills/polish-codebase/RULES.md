# Polishing Rules — full reference

The canonical rulebook for behavior-neutral polishing sweeps of TarmacView
(Python backend + React/TypeScript frontend). `SKILL.md` is the operational
summary; this file is the authority for edge cases and rationale. `docs/
conventions.md` and `CLAUDE.md` point here (Rule R11) — do not fork the rules.

This codebase is the thesis artifact. FI MUNI implementation-thesis rules grade
code quality and documentation directly, so these are graded standards, not
optional hygiene.

---

## R1 — File length (tiered, language-split)

No language standard mandates a line count; React consensus is ~150–250 lines
per component, Python (PEP 8 / Google) judges by single responsibility. Line
count is therefore a **trigger for a mandatory decision**, never an automatic
action.

| Band | Python module | React/TS file | Action |
|---|---|---|---|
| Healthy | ≤ 400 | ≤ 250 | none |
| Watch | 400–600 | 250–400 | backlog note **if** a clean seam exists |
| Decompose | > 600 | > 400 | **must** be a backlog issue with a named split seam |
| Hard | > 1000 | > 700 | backlog issue, high-priority |

Measured as **physical lines** (verifiable; no "minus blanks" guesswork).
Carve-outs that never count and are never swept: `backend/migrations/**`,
`*.test.*`, `*.spec.*`, `__tests__/**`, `**/locales/*.json`, generated bundles
(`dist/`, `build/`), `node_modules/`.

A sweep **never decomposes a large file inline** — see R9. It only guarantees
the file is filed as a GitHub Issue with a concrete seam (or recorded in the
Watch-band section of `SKILL.md` if tolerated).

---

## R2 — Module / file docstring

PEP 257: *all modules should normally have docstrings*, including the package
docstring in `__init__.py`. Every non-empty `.py` gets a one-line module
docstring: lowercase, ends with a period, states what the module **is** (not a
listing of its contents). Empty `__init__.py` stays empty — they mark regular
packages; adding content or deleting them risks PEP-420 namespace behavior that
breaks pytest collection / the import-boundary gate / mypy.

TypeScript/React: a file-level docstring is not idiomatic. Instead the exported
component or hook carries a one-line TSDoc summary in the **canonical TS form**
(see below). Internal sub-components are exempt.

### Canonical TS docstring form (binding — do not re-litigate per folder)

This is pinned so R10's "match the majority" cannot drift folder by folder. The
single correct form for every documented TS/TSX symbol is:

- A one-line `/** summary. */` block (single space after `/**`, single space
  before `*/`), lowercase, ending in a period.
- Placed **directly above** the declaration that introduces the exported symbol
  — the line above `export function X`, `export default function X`,
  `export const X =`, or above `const X = …` when the symbol is exported
  separately / wrapped in `forwardRef`/`memo`. Never as the first statement
  inside the function body.
- The same above-declaration form applies to any internal helper that is
  documented at all (documenting internal helpers stays optional per R3).

In-body first-statement docstrings, the no-space `/**x.*/` form, and `//`
line-comment summaries on exported symbols are all **violations** and are
normalized to the canonical form. This rule overrides any pre-existing
folder-local majority — it is the codebase-wide majority by decree, not by
count. `scripts/inventory.py` reports placement violations deterministically.

---

## R3 — Function / class docstring

Every `def`, `async def`, and `class` has a docstring (PEP 257 + project
standing rule). Format, per Google style: one physical summary line, imperative,
lowercase, terminated by a period. No multi-paragraph essays — the codebase
voice is terse.

Edge cases:

- Public function / method / class: **required**.
- Trivial accessors, `__repr__`, one-line def: required but ultra-short
  (`"""string form for logging."""`).
- Nested closures / local helpers inside a function: **optional** when the name
  is self-evident; **required** when the logic is non-obvious.
- React/TS: exported component/hook/function required, in the **canonical TS
  form** pinned under R2 (one-line `/** summary. */` directly above the
  declaration, never in-body); internal sub-components optional but, if
  documented, same form.

Never put a thesis reference in a docstring (OPSEC). Never an AI/generation
marker.

---

## R4 — Named constants (meaning-first + rule of three)

Named constants give a single source of truth and prevent silent
duplication-by-literal. But extracting on the *second* sighting often produces
the wrong shared abstraction ("duplication is cheaper than the wrong
abstraction"). So the trigger is **meaning first, then rule of three**:

- A literal with **domain meaning** (a regulatory angle, a tolerance, a timeout,
  a buffer distance, a retry budget) → named constant on **first** use, even if
  used once. Meaning, not repetition, is the trigger.
- A **meaningless** repeated literal → extract on the **third** occurrence, not
  the second.
- **Exempt**: `0`, `1`, `-1`, `""`; `2` in obvious halving/pairing; HTTP status
  codes already named by the framework; test fixtures.

Scope:

- Used within one module → module-level `UPPER_SNAKE_CASE` constant
  (`camelCase`/`UPPER_SNAKE` per the frontend casing table in conventions.md).
- Used across modules → a shared location (the backend trajectory `types.py`
  constant pattern; `frontend/src/constants/`). Never declare the same constant
  in two files — that is the duplication, just promoted.
- A cross-module extraction that touches a T3 path
  (`**/trajectory*`, `**/safety_validator*`, `**/flight_plan*`, migrations) is
  **flagged in the backlog**, not moved inline (behavior risk).

---

## R5 — Human-readable names

Names are intention-revealing and searchable. Banned as identifiers: `data`,
`temp`, `tmp`, `item`, `val`, `x`, `arr`, `obj`, `res`, `ret`, `foo`, `bar`
(loop indices `i`/`j` in a tight numeric loop are fine). Casing follows the
existing table in `docs/conventions.md`.

A rename is a **polish edit only when purely local** — a local variable or a
private helper with no external importer, proven by the compiler and tests.
Renaming a public symbol, an API response field, a DB column, a Pydantic schema
field, or anything crossing the route/schema boundary is **not** a polish edit;
it goes to the backlog as its own issue.

---

## R6 — Inline comments (uniform why-not-what + peer consistency)

Comments explain **why**, not **what**. The rule is uniform across the whole
codebase — there is no routes-vs-services distinction.

Decision tree:

1. Does the comment restate what the next line does? → **delete it.**
2. Does it explain *why* — a workaround, a footgun, a domain/regulatory
   constraint, a performance trade-off, a non-obvious ordering? → **keep it**,
   lowercase, dashes (`-`) not em-dashes.
3. Is it a section label over a logical group (`# relationships`,
   `# missions`)? → **keep it.**
4. Is it a value annotation (`# 500MB`, `# ±15 deg per ZEPHYR`)? → **keep it.**

**Peer-consistency clause (this is the part that was undecided).** A "why"
comment or section label is allowed anywhere it genuinely improves readability.
But parallel constructs must be treated identically: if one route handler, one
function in a sibling set, or one branch of a parallel `if/elif` carries a
comment or section label, **every sibling gets the same treatment**. A lone
commented sibling among bare ones — or one labelled group among unlabelled peers
— is itself the inconsistency the sweep fixes (this is R10 applied to comments).

### Forbidden comment / docstring content (binding — OPSEC + thesis quality)

No comment **or** docstring, in any language, and no per-folder `CLAUDE.md`,
may contain:

- A thesis reference of any kind.
- An AI / generation marker.
- **A reference to a GitHub issue, pull request, commit hash, or any external
  tracker ID** — e.g. `#525`, `PR #540`, `fixed in #468`, `before #449`, a bare
  `d4a7b8c9e012` migration/commit hash cited as provenance, `see issue …`.

Reason: the repository is **not published** and the codebase is archived
**separately** from any tracker, so every such reference dangles to nothing. In
a thesis-submission artifact it reads exactly like a left-behind `TODO`. The
*rationale* a reference was standing in for is often worth keeping — but it must
be rewritten **self-contained**: state the actual reason, not the ticket
number.

- Before: `# null on legacy rows written before #525`
- After: `# null on legacy rows from before the sequence-number backfill`

If a comment's *only* content is the tracker reference, delete the comment.
Cross-cutting context that genuinely needs recording goes in the per-folder
`CLAUDE.md` — but stated self-contained there too, never as a bare `#525` that
points nowhere. This generalizes the standing no-thesis-refs rule;
`scripts/inventory.py` reports tracker-reference hits deterministically.

The uniform comment rule above also supersedes the earlier, stricter
"routes carry only labels and annotations" convention from an earlier polish
cycle: that stricter subset is still valid code, but new sweeps apply the
uniform rule.

---

## R7 — Detection is tool-proven, never hand-grepped

Dead code is proven dead by knip (`npx knip`), the compiler (`tsc -b`,
`tsc -b --force`, `vite build`), or the test suites — never by a single
`grep`. This rule exists because a `grep` using GNU `\|` alternation silently
matched nothing under macOS BSD grep and a non-dead file
(`core/dependencies.py`) was deleted and had to be restored. Importer scans use
`scripts/inventory.py` (Python `ast`, portable) or ripgrep with verified
alternation, and the result is confirmed by a green build/test run.

---

## R8 — Behavior-neutral gate

After every batch, all of the following pass before the batch is committed:

- `ruff check .` and `ruff format --check .` clean
- `npm run lint` clean
- `tsc -b` and `vite build` exit 0
- full `pytest` green (incl. T3 suites if a T3 path was touched)
- `npx vitest run` green
- `scripts/structural-tests.sh` exit 0

If any fails, the batch is reverted and retried smaller. No `--no-verify`, no
skipped suites, no "fix later".

---

## R9 — Decomposition is never inline

Oversized files (R1 Decompose/Hard) and R5-public renames are **not** done in
the sweep. Apply the worth-it evaluation first (see SKILL.md non-negotiables).
If the verdict is "file", open a GitHub Issue with a concrete named seam
(which functions move where, what invariant must be preserved) — feature
template, `refactor` + tier label, `harnext:start`, no `agent:plan` (see
memory `feedback_harnext_start_label`, `feedback_no_agent_plan_label`). One
issue per file/seam. T3 files additionally need extra test coverage + human
review noted on the issue. If the verdict is "skip / watch-band", record the
file + rationale in the *Watch-band — deliberately not split* section of
`SKILL.md` so future audits don't re-litigate. The sweep PR itself stays small
and behavior-neutral.

---

## R10 — Consistency over local preference

When two files disagree on a defensible style choice (docstring punctuation,
section-label placement, comment density, import grouping), the sweep makes them
match the **majority existing pattern in the codebase**, not a newly invented
one. Polishing converges the codebase on what it already mostly does; it does
not introduce a personal style. The R6 peer-consistency clause is this rule
applied to comments.

---

## R11 — One canonical source

These two files (`SKILL.md` + `RULES.md`) are the single source of truth for
polishing rules. `docs/conventions.md` and `CLAUDE.md` carry a one-line pointer
here and must not restate or fork the rules. If a rule changes, it changes here
and nowhere else.

---

## Sweep order (reproducibility)

Backend: `models → schemas → core → utils → services → api`
Frontend: `types → constants → utils → hooks → components → pages`

One folder per batch, in this exact order, every time. The fixed order plus the
`SKILL.md` per-file checklist plus `scripts/inventory.py` are the consistency
mechanism: same inputs, same procedure, same result, nothing forgotten.

## Relevant memory / standing facts

- Decomposition candidates are filed as GitHub Issues (feature template,
  `refactor` + tier label, `harnext:start`, no `agent:plan`). Watch-band
  tolerations live in the *Watch-band — deliberately not split* section of
  `SKILL.md`.
- `feedback_verify_deletions_with_compiler` — never call code dead from a hand
  grep; prove with compiler/tests (origin of R7).
- `feedback_no_thesis_refs` — no thesis references in code or docstrings.
- `feedback_no_ai_artifacts` — no AI attribution anywhere in code/commits/PRs.
- Local Postgres collation drift makes `test_drone_profiles::test_get_drone`
  flake on a clean tree; fix with `ALTER DATABASE tarmacview REFRESH COLLATION
  VERSION;` — not a code defect, not a sweep finding.
