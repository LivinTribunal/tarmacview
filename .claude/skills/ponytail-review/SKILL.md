---
name: ponytail-review
description: >
  Code review focused exclusively on over-engineering. Finds what to delete:
  reinvented standard library, unneeded dependencies, speculative abstractions,
  dead flexibility. One line per finding: location, what to cut, what replaces
  it. Default scope is a diff; pass "repo-wide" / "audit" to scan the whole tree
  instead, ranked biggest-cut-first. Use when the user says "review for
  over-engineering", "what can we delete", "is this over-engineered", "simplify
  review", "audit the codebase", "find bloat", or invokes /ponytail-review.
  Complements correctness-focused review, this one only hunts complexity.
license: MIT
---

Review diffs for unnecessary complexity. One line per finding: location, what
to cut, what replaces it. The diff's best outcome is getting shorter.

## Format

`L<line>: <tag> <what>. <replacement>.`, or `<file>:L<line>: ...` for
multi-file diffs.

Tags:

- `delete:` dead code, unused flexibility, speculative feature. Replacement: nothing.
- `stdlib:` hand-rolled thing the standard library ships. Name the function.
- `native:` dependency or code doing what the platform already does. Name the feature.
- `yagni:` abstraction with one implementation, config nobody sets, layer with one caller.
- `shrink:` same logic, fewer lines. Show the shorter form.

## Examples

❌ "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

✅ `L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.`

✅ `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`

✅ `inspection_service.py:L88: yagni: AbstractExporter with one implementation. Inline it until a second format exists.`

✅ `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`

✅ `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with the only metric that matters: `net: -<N> lines possible.`

If there is nothing to cut, say `Lean already. Ship.` and stop.

## Repo-wide (audit) mode

Same tags, same line-per-finding format — just point it at the whole tree
instead of a diff when the ask is "audit the codebase" / "what can I delete from
this repo" / "find bloat" (or `/ponytail-review repo-wide`). Rank findings
biggest-cut-first and append deps to the score: `net: -<N> lines, -<M> deps
possible.` Hunt list: deps the stdlib or platform already ships,
single-implementation interfaces, factories with one product, wrappers that only
delegate, files exporting one thing, dead flags and config, hand-rolled stdlib.
One-shot report — lists findings, applies nothing.

## Boundaries

Scope: over-engineering and complexity only. Correctness bugs, security holes,
and performance are explicitly out of scope. Route them to a normal review pass
(`/code-review` or `review-proof`), not this one. A single smoke test or
`assert`-based self-check — and the docstrings TarmacView requires on every
`def`/`class` — are not bloat, never flag them for deletion. Does not apply the
fixes, only lists them.

Pairs with `grain-review` (structural / spaghetti review). When a cut proposed
here would break an established local convention — a thin wrapper that matches
its sibling wrappers, a service-module function that mirrors the others, an
aggregate-root method like the rest of `Mission`'s — `grain-review` overrules
it: consistency beats brevity for shared, convention-bearing code. Minimalism
wins only for genuinely novel one-off code with no sibling. The layer/import
boundaries either review points at are enforced by `scripts/lint-architecture.ts`
and `harness.config.json`.

"stop ponytail-review" or "normal mode": revert to verbose review style.
