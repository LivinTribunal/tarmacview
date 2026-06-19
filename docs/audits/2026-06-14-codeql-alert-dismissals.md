# CodeQL code-scanning alert dismissals

**Date:** 2026-06-14
**Issue:** [#16](https://github.com/LivinTribunal/tarmacview/issues/16)
**Scope:** the three open `high`-severity GitHub code-scanning (CodeQL) alerts
**Outcome:** all three dismissed with justification — no code change in this repo

## Why this doc exists

A dismissal in the Security UI lives outside the repo and can silently re-surface on a
later CodeQL re-scan. This file is the durable in-repo record of *why* each alert was
dismissed, so a future re-scan does not re-open an undocumented finding. It records the
justification text, the dismissal reason, and the concrete code references each
justification leans on.

The dismissals themselves are an out-of-band action (Security UI, or
`gh api .../code-scanning/alerts/{N}` with a token carrying `security_events`). The
pipeline bot token cannot read or write code-scanning alerts (`403 Resource not
accessible by integration`), so the dismissal + the acceptance check below are
maintainer / PAT work.

## Alerts

| # | Rule | Location | Reason | State |
|---|------|----------|--------|-------|
| 1 | `actions/untrusted-checkout-toctou/high` | `.github/workflows/claude-assistant.yml:62` | Won't fix (mitigated) | dismissed |
| 2 | `actions/untrusted-checkout/high` | `.github/workflows/claude-assistant.yml:62` | Won't fix (mitigated) | dismissed |
| 3 | `py/clear-text-storage-sensitive-data` | `backend/app/services/video_processing/reports.py:71` | False positive | dismissed |

> Dismiss reason note: **not** "Used in tests" — that is wrong for all three. Use
> "Won't fix" for #1/#2 and "False positive" for #3.

---

### Alert #1 — `actions/untrusted-checkout-toctou`

**Where:** `.github/workflows/claude-assistant.yml:62` (the `Checkout PR head SHA` step).

**What CodeQL flags:** `claude-assistant.yml` runs on `issue_comment` — a privileged
trigger with a read/write `GITHUB_TOKEN` and secret access — and checks out PR-head
code. The TOCTOU variant warns that the code resolved when the workflow dispatches can
differ from the code checked out if the branch ref is mutated (force-push) in between.

**Why it is already mitigated:** the checkout is pinned to the head SHA resolved at
workflow start, not the mutable branch ref:

- `Resolve PR context` (`:39-55`) reads `headRefOid` once and exports it as
  `steps.pr.outputs.head-sha`.
- `Checkout PR head SHA` (`:62-67`) checks out `ref: ${{ steps.pr.outputs.head-sha }}`
  (`:65`) — the pinned commit, not `head-ref`.

A force-push between comment dispatch and checkout cannot swap in different code: the
SHA is already fixed. This is exactly the fix CodeQL recommends for this rule. The
inline comment at `:57-61` documents the same rationale at the call site.

**Justification (dismiss as "Won't fix"):**
> Checkout is pinned to the head SHA resolved at workflow start
> (`claude-assistant.yml:65`, `ref: steps.pr.outputs.head-sha`), not the mutable branch
> ref, which closes the TOCTOU window a force-push could exploit — the fix this rule
> recommends. The trigger is additionally gated to OWNER/COLLABORATOR/MEMBER comment
> authors (`:20-24`), so an untrusted actor cannot run the job at all. Won't fix.

---

### Alert #2 — `actions/untrusted-checkout`

**Where:** `.github/workflows/claude-assistant.yml:62`.

**What CodeQL flags:** the structural pwn-request shape — a privileged `issue_comment`
workflow that checks out PR-head code could execute untrusted code with secrets in
scope.

**Why it is already mitigated:** the job `if:` gate (`:20-24`) restricts the trigger to
trusted authors:

```yaml
if: >-
  github.event.issue.pull_request && contains(github.event.comment.body, '@claude')
  && (github.event.comment.author_association == 'OWNER'
   || github.event.comment.author_association == 'COLLABORATOR'
   || github.event.comment.author_association == 'MEMBER')
```

An attacker who forks the repo and comments is not OWNER/COLLABORATOR/MEMBER, so the
privileged job never runs their code. That is the practical mitigation for this rule.

The full CodeQL-recommended fix (split into an unprivileged `pull_request` job that
uploads an artifact + a privileged `workflow_run` job that consumes it) is a large
rewrite of an assistant already gated to trusted associations, and
`.github/workflows/**` is a protected, human-applied path — so it is not worth it here.
Revisit only if the assistant should ever accept comments from non-MEMBER authors.

**Justification (dismiss as "Won't fix"):**
> The job is gated to `author_association == OWNER | COLLABORATOR | MEMBER`
> (`claude-assistant.yml:20-24`), so a forked-repo attacker cannot trigger the
> privileged job at all. Combined with the head-SHA pin (`:65`), the untrusted-checkout
> risk is mitigated. The full `pull_request` + `workflow_run` split is a large rewrite
> of a trusted-author-only assistant in a protected workflow file; not worth it unless
> the trigger is opened to non-MEMBER authors. Won't fix.

---

### Alert #3 — `py/clear-text-storage-sensitive-data`

**Where:** `backend/app/services/video_processing/reports.py:71` (`f.write(html_content)`
in `generate_html_report`).

**What CodeQL flags:** the generated HTML report embeds PAPI-light / touch-point / drone
latitude+longitude (e.g. the reference-point block at `reports.py:148-164`) and writes it
to local disk in clear text. The `py/clear-text-storage-sensitive-data` heuristic
classifies `latitude`/`longitude` as "private" geolocation data, so it sees six source
flows into the one write.

**Why it is a false positive:**

- The coordinates are the **intended content** of an inspection report, not a leaked
  secret or credential. There is no encrypt-at-rest expectation for an inspection
  artifact, and the surveyed PAPI/touch-point positions are reference data, not personal
  geolocation.
- The file lives under the **vendored** engine
  (`backend/app/services/video_processing/`, see `video_processing/VENDORED.md`): a
  verbatim upstream snapshot, **excluded from ruff** (`backend/pyproject.toml`), and
  **not imported anywhere outside `video_processing/`** — `app.main` does not import it,
  so the code is **inert** until the Phase 2 decoupling
  (`docs/specs/TARMACVIEW-MERGE-PLAN.md`).
- A `chmod 0o600` or a move to access-controlled S3/MinIO does **not** clear the data
  flow — CodeQL wants encryption-or-don't-store. Only a dismissal or removing the
  geolocation sink resolves it.

**Phase 2 follow-up:** when the engine is decoupled and brought up to project style
(ruff exclusion dropped per `VENDORED.md`), re-evaluate where the report artifact lands
and whether the geolocation sink survives. The artifact storage story moves to the
shared S3/MinIO abstraction at that point.

**Justification (dismiss as "False positive"):**
> The lat/lon embedded in the HTML report is the intended geolocation content of an
> inspection artifact (surveyed PAPI / touch-point reference positions), not a leaked
> secret — there is no encrypt-at-rest expectation for an inspection report. The file is
> in the vendored, ruff-excluded video-processing engine
> (`backend/app/services/video_processing/`, see `VENDORED.md`) and is inert (no importer
> outside the package; `app.main` does not import it). Re-evaluated at Phase 2 decoupling
> (`docs/specs/TARMACVIEW-MERGE-PLAN.md`). False positive.

---

## Acceptance check

Run by a maintainer / PAT with `security_events` read after dismissing all three:

```bash
gh api repos/LivinTribunal/tarmacview/code-scanning/alerts \
  -q '.[] | select(.state=="open" and .rule.security_severity_level=="high")'
```

Expected: empty output (no open `high`-severity alerts).

---

## Update - 2026-06-18 (#117)

The acceptance check above only reaches "no open `high`-severity alerts" after #117.
That PR cleared a separate, later wave of nine `py/clear-text-logging-sensitive-data`
(High) alerts in the vendored engine - a *different* rule from alert #3's
`py/clear-text-storage-sensitive-data`. These were resolved by **code fix**, not
dismissal: the first-frame and per-frame debug logs in
`backend/app/services/video_processing/generation/measurement_collector.py`,
`info_overlays.py`, and `drone_overlays.py` were dumping raw drone
`latitude` / `longitude` / `elevation_wgs84` (and whole `drone_data` dicts), so #117
dropped the coordinate values - logging a reference-point count plus a present/absent
bool instead. The three dismissals recorded above are unchanged and still stand. Net
after merge: 0 open code-scanning alerts.
