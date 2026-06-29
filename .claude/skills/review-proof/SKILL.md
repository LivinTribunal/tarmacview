---
name: review-proof
description: >
  Review a PR (or the current branch diff), then PROVE each correctness finding
  with a real failing test or runnable reproduction — dropping any finding that
  can't be made to reproduce — and finally run grain-review for structural
  consistency. A three-phase pipeline: (1) multi-agent correctness review, (2)
  test-proof: write/run an actual test or repro per finding and keep only the
  proven ones, (3) grain review for spaghetti / layer / duplication.
  High-precision: every shipped correctness finding comes with executable
  evidence — no false positives. Use when reviewing a PR or working diff and you
  want findings you can trust, not just plausible ones. Triggers: "/review-proof",
  "review and prove", "test-proof the findings", "proven review", "review the PR
  with tests".
license: MIT
---

# Review-Proof

A reviewer that does not trust itself. It reviews, then **forces every
correctness finding to earn its place by reproducing as a real failing test or
runnable repro** — anything that won't reproduce is dropped as a false positive
— and closes with a `grain-review` pass for structural fit. The output is a
review where each correctness item ships with executable evidence, plus a
separate structural section.

This is a local TarmacView skill. It is the test-proving complement to the
built-in `/code-review` (which finds correctness issues but does not prove
them). Phase 1 runs the correctness review inline (self-contained — no
dependency on another skill); Phase 3 invokes the project's `grain-review` skill.

## Arguments & flags

- `review-proof` — auto-detect the target (see Phase 0).
- `review-proof <PR#>` — review that GitHub PR explicitly.
- `--comment` — post the final report back to the PR as a comment (only valid
  when the target is a PR). Without it, the report stays in chat.
- `--diff` — force local-branch-diff mode even if an open PR exists.

Make a todo list first, then run the phases in order.

## Phase 0 — Resolve the target (auto-detect)

1. If a `<PR#>` argument was given, the target is that PR.
2. Else run `gh pr view --json number,state,isDraft,url,headRefName` for the
   current branch. If it returns an **open** PR (and `--diff` was not passed),
   the target is that PR; get the diff with `gh pr diff <num>`.
3. Else the target is the **local branch diff**: the merge-base diff against
   `main` plus any uncommitted work —
   `git diff $(git merge-base HEAD main)...HEAD`, `git diff`, `git diff --cached`.

Eligibility (PR targets only): with a Haiku agent, skip the review if the PR is
closed, a draft you weren't asked to review, trivially automated, or already
carries your review comment. Re-check this right before posting in Phase 4.

Record: the changed-file list, and the **diff is the review scope** — findings
must sit on lines this change actually touched.

## Phase 1 — Correctness review

Gather context first: with a Haiku agent, list the paths (not contents) of the
relevant `CLAUDE.md` files — the root one and any per-package ones in directories
the diff touches (`backend/app/api/routes/CLAUDE.md`, `services/CLAUDE.md`, etc.).
Re-read `docs/specs/SPEC.md` for any feature change and `docs/specs/WIREFRAME.md`
for UI. With another Haiku agent, extract the **intended contract**: from the
linked issue (`Closes #N`) and the PR body, what must be observably true when
this change works — the acceptance criteria / the outcome a downstream consumer
should see — stated *independently of how the diff implements it*. This is the
spec Phase 2 proves against; without it the review can only check the code
against itself and will bless code that does the wrong thing consistently.

Then launch **6 parallel Sonnet agents**, each returning a list of issues with
the reason each was flagged:

- **a. CLAUDE.md adherence** — does the diff comply with the applicable
  `CLAUDE.md` files (root + per-package)? (They are guidance for *writing* code;
  not every line applies at review time.) Includes the DDD-Lite rules: routes
  thin and never importing models, business logic on aggregate methods/services,
  `mission.transition_to()` for status changes, docstrings on every def/class.
- **b. Bug scan** — read only the diff and shallow-scan for real bugs. Large
  bugs only; skip nitpicks and likely false positives.
- **c. Git history** — read `git blame`/log of the modified code; flag bugs that
  only show up against that historical context.
- **d. Prior PRs** — read earlier PRs touching these files; surface review
  comments there that still apply here.
- **e. Code comments** — read comments in the modified files; flag changes that
  contradict documented guidance.
- **f. Integration contract** — for every new/changed call into a collaborator
  the diff does *not* itself define (a service, repo, the Celery worker, object
  storage / MinIO, the field-hub client, an external API), open the **callee**
  and check the new code's assumptions about it actually hold. Two questions:
  (1) **Is this the right collaborator?** Trace the real wiring — the
  factory/selector/`Depends` that decides which impl runs on this path — and
  confirm the code integrates against the one the system actually uses, not a
  plausible-looking sibling. (2) **Does the callee behave as assumed?** Read its
  lifecycle and side effects — does it delete / overwrite / expire / require a
  DB commit / presign / dedupe? Flag code that "works locally" but whose result
  the callee will silently drop, relocate, or never surface to the real consumer.
  This is the lens for bugs that don't crash: wrong-collaborator and
  broken-integration-assumption.

**Coarse pre-filter (cheap, before the expensive proof step).** For each issue,
a Haiku agent scores confidence 0–100 (0 false positive / 50 verified-but-minor
/ 75 likely-real-in-practice / 100 certain). Drop scores `< 50` here — the proof
step in Phase 2 is the real filter, so keep borderline items for it rather than
killing them now. For CLAUDE.md-flagged issues, the agent must confirm the cited
`CLAUDE.md` actually calls out that specific thing.

Treat as **false positives** (do not pass to Phase 2): pre-existing issues; not-
actually-bugs; senior-engineer nitpicks; things a linter/type-checker/compiler
catches (imports, types, formatting, broken tests — CI runs `ruff`, `tsc`,
`pytest`, `vitest` separately, do not run builds yourself); generic "needs more
tests / docs / security" not required by CLAUDE.md; issues silenced intentionally
in-code; intentional behavior changes tied to the PR's purpose; and findings on
lines the PR did not modify.

Carry forward the surviving issues. **Pure-structural / style / placement /
duplication findings are not correctness bugs — do not test-proof them; they are
`grain-review`'s job (Phase 3).** Phase 2 takes only behavioral/correctness
findings.

## Phase 2 — Test-proof the findings (the core)

For each surviving correctness finding, spawn a **Sonnet agent in an isolated
git worktree** (`isolation: "worktree"` — agents write throwaway test files and
run them in parallel, so they must not share a tree). Run them concurrently.

Each agent's job: **make the bug reproduce, or drop it.**

A finding is provable in one of two ways — pick by its kind:

- **Crash / wrong-output bug:** a test that throws or asserts the wrong value on
  current code. Red proves it.
- **Spec / contract divergence** (the code runs without error but does the
  *wrong* thing — wrong collaborator, missing side effect, result the real
  consumer never sees): prove it **from the consumer's vantage**. Write the test
  that encodes the Phase-1 intended contract by exercising the **real downstream
  collaborator** (or a stand-in that faithfully reproduces its documented side
  effects — object-storage expiry/overwrite, a Celery task that re-queues, a
  presign that pins a region), and show it fails red on current code.

> **Tautological proofs do not count.** A test that mocks the very collaborator
> whose behavior is in question and then asserts it was called only re-states the
> implementation — it passes on buggy code and proves nothing. "The test is
> green" means "no bug" *only* when the test exercised the real contract. When
> the finding is about wiring/integration, prefer an end-to-end repro that boots
> the **real** subsystem (run the flow against the local Postgres + MinIO +
> Celery stack — see the `init` skill / `docker-compose.yml`); a mock can only
> confirm the buggy assumption. If neither a real-subsystem repro nor a
> side-effect-faithful stand-in is achievable here, the finding is **not
> provable → drop it**, but list it in the dropped set with the integration risk
> named so it is not silently lost.

1. Construct the smallest test or script that demonstrates the claimed bug:
   - **Backend** (`backend/`): a `pytest` test under `backend/tests/` (mirror the
     nearest existing test's structure; name it `test_*`). Run it:
     `cd backend && pytest <path> -x -q`. The test must **fail in a way that
     demonstrates the bug** on current code (red proves the bug exists). The test
     DB is a shared, session-scoped Postgres — any airport a proof test inserts
     must use an `icao_code` prefix no other test uses (see the root `CLAUDE.md`
     testing notes), or it will collide. Prefer a repro that needs no DB at all
     when the bug allows it.
   - **Frontend** (`frontend/`): a co-located `vitest` test (`{Thing}.test.tsx`
     next to its sibling, matching the existing layout). Run it:
     `cd frontend && npx vitest run <path>`. Same bar — it must fail
     demonstrating the bug.
   - **UI-only behavior** that can't be unit-tested: attempt a runnable repro via
     the `verify` / `browser-verify` path (boot the app, drive the exact step,
     observe the broken behavior). If even that isn't practical, the finding is
     **not provable here** → drop it.
2. Verdict:
   - **proven** — the test/repro reproduces the bug. Capture: the full test
     source (paste it into the return — the worktree is discarded afterward), the
     command, and the failing output (assertion / error / observed-vs-expected).
   - **dropped** — after a genuine attempt the bug does not reproduce (guard
     exists upstream, path unreachable, behavior actually correct, or claim was
     too vague to pin down). One-line reason.
3. Return strictly: `{ finding, file, line, status: proven|dropped, test_path,
   test_source, command, output, note }`.

Do **not** commit, push, or leave test files in the user's working tree — they
live and die in the worktree; the proof is the captured `test_source` + `output`
in the return.

After all agents finish: the **proven** set is the correctness result. List
**dropped** ones compactly (so the user sees what was considered and why it
didn't survive) — they do not block.

## Phase 3 — Grain review

Invoke the project's **`grain-review`** skill on the same target diff (Skill
tool, `skill: "grain-review"`). It hunts structural divergence — `diverge` /
`duplicate` / `layer` / `misplaced` / `reach-in` / `inconsistent` / `chain` —
each with the existing exemplar to align to. Collect its findings verbatim; this
is a separate section, not merged into the proven correctness list.

## Phase 4 — Report

Keep it brief, no emojis, cite/link each item.

```
### Review-proof: <PR #N | branch <name>>

**Proven correctness findings (N)** — each reproduced by a test/repro:

1. <description> — <file>:L<line>
   Proof: `<command>` → <one-line failing result>
   <test source in a collapsed block, or PR-permalink to the line>

**Dropped during proof (M)** — considered, did not reproduce:
- <description> — <one-line reason>

**Structural (grain-review)** — does it go with the grain:
<grain-review findings verbatim, or its clean verdict>
```

If there are zero proven findings and grain-review is clean, say so plainly:
`No reproducible correctness issues; structure goes with the grain.`

### Posting to a PR (`--comment`)

Only for PR targets, and only after re-running the Phase 0 eligibility check.
Use `gh pr comment <num>`. Link every cited line with a **full-SHA permalink**
(`https://github.com/LivinTribunal/tarmacview/blob/<full-sha>/<path>#L<a>-L<b>`,
≥1 line of context each side) — resolve the SHA with `gh`/`git`, never inline a
`$(...)` command into the comment markdown. **Do not append any AI-attribution
line** ("Generated with Claude Code" etc.) — this repo's convention is no AI
attribution in PRs or comments.

## Boundaries

- **Correctness review → test-proof → structure.** Correctness findings must
  reproduce or they're dropped; high precision over recall by design.
- Reads and reports only. The test-proof step writes/runs tests **inside a
  throwaway worktree** — nothing lands in the user's tree, nothing is committed.
- Over-engineering / "what to cut" is **not** in scope — that's `ponytail-review`.
- Do not run lint/type-check/build as part of the review; CI owns those.
- "stop review-proof" / "normal mode" to revert.
