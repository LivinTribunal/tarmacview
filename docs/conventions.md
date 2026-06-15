# Conventions

Authoritative reference for coding standards, git workflow, quality gates, and OPSEC rules in TarmacView.

> Behavior-neutral polishing-sweep rules (file length, module/function docstrings, named constants, comment policy, naming consistency) are canonically defined in the `polish-codebase` skill (`.claude/skills/polish-codebase/`). This document states the project conventions; that skill governs how a consistency sweep applies them. The skill is the single source of truth for the sweep rules - they are not forked here.

---

## Naming

### Files

- **Backend**: `snake_case.py` - `airport.py`, `mission_service.py`, `flight_plan.py`
- **Frontend components**: `PascalCase.tsx` - `AirportMap.tsx`, `InspectionList.tsx`
- **Frontend utilities**: `camelCase.ts` - `formatDate.ts`, `useAuth.ts`
- **Frontend types**: `camelCase.ts` in `src/types/` - `mission.ts`, `airport.ts`
- **Config files**: lowercase with dots - `pyproject.toml`, `vite.config.ts`

### Python

- Variables and functions: `snake_case`
- Classes: `PascalCase` - `Airport`, `MissionConfiguration`, `FlightPlan`
- Constants: `UPPER_SNAKE_CASE`
- Enums: `PascalCase` class, `UPPER_SNAKE_CASE` values - `MissionStatus.DRAFT`

### TypeScript

- Variables and functions: `camelCase`
- Components: `PascalCase` (matching filename)
- Interfaces/types: `PascalCase`, no `I` prefix - `Mission`, `WaypointResponse`
- Constants: `UPPER_SNAKE_CASE`

### Backend Schemas

Pydantic schemas follow `{Entity}{Suffix}`:
- `AirportResponse`, `AirportCreate`, `AirportUpdate`
- `MissionResponse`, `MissionCreate`
- `WaypointResponse`, `WaypointCreate`

### API Routes

RESTful paths under `/api/v1/`:
```
GET    /api/v1/missions
POST   /api/v1/missions
GET    /api/v1/missions/{id}
PUT    /api/v1/missions/{id}
DELETE /api/v1/missions/{id}
GET    /api/v1/airports/{id}/surfaces
```

---

## Import Organization

### Python

Ordered by convention, enforced by Ruff `I` rule:

```python
# 1. standard library
from uuid import uuid4
from typing import Optional

# 2. third-party
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

# 3. local application
from app.core.database import get_db
from app.models.mission import Mission
from app.schemas.mission import MissionResponse
```

### TypeScript

```typescript
// 1. react / framework
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';

// 2. third-party libraries
import axios from 'axios';
import maplibregl from 'maplibre-gl';

// 3. local imports (using @ alias)
import { Mission } from '@/types/mission';
import { apiClient } from '@/api/client';
```

---

## Docstrings and Comments

### Docstrings

Every `def` function and every `class` must have a `"""..."""` docstring. Short, lowercase, one line when possible.

```python
# good
def create_mission(db: Session, data: MissionCreate) -> Mission:
    """create a new mission in DRAFT status."""

# bad - too verbose
def create_mission(db: Session, data: MissionCreate) -> Mission:
    """Creates a new mission record in the database with DRAFT status
    and returns the fully populated Mission ORM instance."""
```

### Comments

- Sparse, lowercase, casual. Only comment non-obvious logic.
- Never comment what the code obviously does (`# create engine`, `# add cors middleware`).
- Use short section labels above logical groups: `# test db config`, `# relationships`
- Use dashes (`-`) not em-dashes in comments
- Inline comments only for non-obvious things: `# discriminator`, `# noqa: F401`
- Always a blank line before a section comment, no blank line between the comment and the code it describes
- Add a blank line after a logical block ends
- Never write `@author` tags or generation markers

---

## Error Handling

### Backend

- **HTTP errors**: raise `HTTPException` with appropriate status codes in route handlers
- **Service errors**: raise domain-specific exceptions that routes catch and translate to HTTP responses
- **Validation errors**: Pydantic handles request validation automatically - FastAPI returns 422
- **Database errors**: let SQLAlchemy exceptions propagate; handle specific cases (unique constraint, not found) in services

### Frontend

- **API errors**: Axios interceptor handles 401 (redirect to login) and network errors globally
- **Component errors**: try/catch in async handlers, user-friendly messages via toast/alert
- **Never swallow errors silently** - at minimum log to console in development

---

## Testing

### Backend

- **Framework**: pytest + httpx (async API tests)
- **Location**: `backend/tests/` - mirrors `app/` structure
- **Naming**: `test_{module}.py` - `test_airport.py`, `test_trajectory_generator.py`
- **Config**: `pyproject.toml` sets `testpaths = ["tests"]`, `asyncio_mode = "auto"`
- Test data in `tests/data/` modules, fixtures in `conftest.py`
- **Unique airport ICAO codes per test file**: the test DB is session-scoped (one Postgres for the whole run, no per-test teardown - see `conftest.py::db_engine`), and `airport.icao_code` is `UNIQUE`. So every `icao_code` a test inserts must be unique across the *entire* suite, not just its own file, or it raises `duplicate key value violates unique constraint "airport_icao_code_key"` depending on collection order. Give each file its own distinctive prefix and never start a counter at `AAAA` (already taken by `test_admin.py`).

### Frontend

- **Framework**: Vitest + React Testing Library
- **Location**: co-located `{Component}.test.tsx` or grouped `{group}.test.tsx` for lightweight components
- **Naming**: `{Component}.test.tsx`, `{module}.test.ts`, or `{group}.test.tsx` for shared test files
- **Grouped tests**: simple/related components can share a test file (e.g. `common.test.tsx` for Button, Input, Modal, Badge, Card, Dropdown, CollapsibleSection, RowActionMenu)
- **Command**: `npx vitest run`

### What Must Be Tested

- All service methods (unit tests)
- All API routes (integration tests against a real Postgres container)
- Complex UI interactions (component tests with Testing Library)
- Context providers (auth, airport, theme state management)
- Trajectory generation and safety validation (T3 - thorough coverage required)

---

## Linting and Formatting

### Python

Ruff configured in `pyproject.toml`:
```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I"]
```

### TypeScript / Frontend

ESLint configured via `eslint.config.js`: `npm run lint`.

---

## Git Workflow

### Commit Messages

Conventional commit prefix required (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`). After the prefix the message stays short, lowercase, casual.

```
feat: airport crud endpoints
fix: map marker click
refactor: trajectory service
docs: update spec for inspection heading override
```

Reference the GitHub issue number when applicable:

```
feat: database schema (#1)
feat: airport crud endpoints (#2)
```

Keep the body human - no `feat(backend): implement AirportRouter with full CRUD operations`-style scopes-and-camelcase.

### Branch Naming

Format: `<type>/<short-description>`:

```
feat/db-models
feat/airport-api
fix/null-check
feat/frontend-shell
```

One issue per branch. Every branch merges into `main` via squash merge.

### Pull Requests

- Title: short, conventional prefix required (matches commit style)
- Description: 1-2 sentences, include risk tier checkbox (T1/T2/T3)
- Always link the related GitHub issue with `Closes #N`
- Never include AI attribution text
- Keep the PR body in sync with the code. If a change diverges from the open PR's description (added correctness fix, expanded scope, behavior change, or a fix folded in from another issue), update the body via `gh pr edit <num> --body-file ...` without waiting to be asked. Either extend the in-scope section if the change is a continuation of the PR's root cause, or add an explicit "Folded-in fixes" section naming each unrelated fix, its root cause, and why it rode along. The "one issue per branch" rule still wins - disclosure is the fallback when bundling has already happened.

### Git Identity

All commits must use:
```
Štefan Moravík <stevko.moravik@gmail.com>
```

---

## Quality Gates

Every line of code passes through six gates before reaching `main`.

### Gate 1 - Pre-commit hooks (local)

Config: `.pre-commit-config.yaml`. Runs on `git commit`:
- `ruff check --fix` - Python lint with auto-fix
- `ruff-format` - Python formatting
- `trailing-whitespace` - strip trailing whitespace
- `detect-private-key` - block accidental key commits
- `check-added-large-files` - block files > 500KB

Install: `pre-commit install`

### Gate 2 - Agent implementation (harnext pipeline)

Config: `CLAUDE.md` + the prompt embedded in `.github/workflows/harnext-implement.yml`.

The agent reads CLAUDE.md, writes code following architecture rules, runs linters and tests, fixes failures, pushes the branch, and opens a draft PR.

### Gate 3 - Gap agent (automatic, on PR)

Config: prompt embedded in `.github/workflows/harnext-gap.yml`. Bridge loop in `harnext-gap-bridge.yml` (up to 3 iterations before parking on `harnext:needs-judgment`).

Compares the linked issue's acceptance criteria against the PR diff and posts a verdict (`CLEAN`, `GAPS_ACCEPTED`, or `GAPS_NEEDS_FIX`). On `GAPS_NEEDS_FIX` the bridge auto-addresses the missing criteria and re-dispatches gap. PRs with no `Closes #N` / `Fixes #N` reference skip the loop and advance straight to review.

### Gate 4 - Review agent (automatic, on PR)

Config: prompt embedded in `.github/workflows/harnext-review.yml`. Review-fix loop in `harnext-review-fix.yml` (up to 5 iterations before parking on `harnext:needs-judgment`).

Reviews every PR for architecture compliance, schema usage, test presence, migration inclusion, OPSEC violations.

### Gate 5 - GitHub Actions CI (automatic, on PR)

Config: `.github/workflows/ci.yml`. Risk-gated by `scripts/risk-policy-gate.sh`.

| Tier | Patterns | Required Checks |
|------|----------|-----------------|
| T1 (low) | `docs/**`, `*.md` | lint |
| T2 (medium) | `backend/app/**`, `frontend/src/**`, tests, config | lint, type-check, test, build |
| T3 (high) | `**/trajectory*`, `**/safety_validator*`, `**/flight_plan*`, `**/migrations/versions/*` | all T2 + manual approval |

The verify stage (`harnext-verify.yml`) re-runs lint/test/typecheck/build on the PR branch and triggers the bundled `browser-verify` skill on the self-hosted runner whenever the change has a user-visible surface - a `frontend/` path in the diff, an API response field rendered by the frontend, or a linked issue whose acceptance criteria mention a UI surface. Pure-refactor, test-only, dep-bump, CI/docs, and migration-only diffs skip with verdict `SKIPPED-NO-UI-SURFACE`.

### Gate 6 - Human review (manual, before merge)

1. Read the code - you defend this at your thesis presentation
2. Make 3-5 small changes: rename a variable, reword a comment, add a TODO
3. Verify acceptance criteria from the issue
4. Squash merge with a casual commit message
5. Space merges out - morning and evening, not all at once

### Gate 7 - Continuous security scanning (post-merge, scheduled)

Config: `.github/workflows/codeql.yml`, `.github/workflows/codacy.yml`, `.codacy.yaml`.

CodeQL Advanced scans actions, JavaScript/TypeScript, and Python on push to `main` and weekly. Codacy runs the Codacy Analysis CLI (which wraps Bandit for Python; bandit options live under `[tool.bandit]` in `backend/pyproject.toml`) on push to `main` and weekly. Both upload SARIF to GitHub Advanced Security; findings show up under the Security tab. Tests, migrations, generated bundles, and docs are excluded via `.codacy.yaml`. These scans do not block PR merge - they surface issues for follow-up.

---

## Protected Files

These files must only be modified by a human, never by an agent:
- `.github/workflows/**` - CI and harnext pipeline definitions
- `harness.config.json` - risk tier configuration
- `backend/requirements.txt` - Python dependencies (pinned versions)
- `frontend/package-lock.json` - npm lockfile

`CLAUDE.md` is editable by agents (e.g., during doc-gardening) when the user explicitly requests it.

---

## Risk Tiers

Defined in `harness.config.json`:

| Tier | File Patterns | Required Checks |
|------|---------------|-----------------|
| **T1** (low) | `docs/**`, `*.md` | lint |
| **T2** (medium) | `frontend/src/**`, `backend/app/**`, `backend/tests/**` | full test suite, linter, code review |
| **T3** (high) | `**/trajectory*`, `**/safety_validator*`, `**/flight_plan*`, `**/migrations/versions/*` | all T2 + manual review sign-off |

---

## OPSEC Rules

### Rule 1 - No AI artifacts in public repos

This repo is **private** - `CLAUDE.md`, `harness.config.json`, `.claude/`, and the harnext workflow files are committed so that CI workflows and agents can read them. If the repo ever becomes public, add these to `.gitignore` immediately.

Never include AI attribution in commits, PR descriptions, or code comments regardless of repo visibility.

### Rule 2 - Git history must look human

- Squash merge everything - every PR becomes one commit under your name
- Casual commit messages - `airport api endpoints`, not `feat(backend): implement AirportController`
- Space out merges - morning + evening, not 10 in 30 minutes
- Vary commit sizes - some 5 files, some 1 file, occasional README update

### Rule 3 - Code must have human fingerprints

After every agent PR, before merging:
1. Read the code - you defend this at thesis presentation
2. Make 3-5 small changes: rename a variable, reword a comment, add a TODO
3. Leave an imperfection - a slightly verbose method, an unused import cleaned up later

Code comments should sound natural:
```python
# bad:
# Validates the waypoint against all registered obstacle geometries
# and safety zone polygons using spatial intersection tests

# good:
# check if waypoint hits any obstacles or safety zones
```

### Rule 4 - Knowledge defense

For every agent-generated PR you merge:
1. Read the code
2. Understand WHY it works
3. Be ready to explain it on a whiteboard
4. Know what alternatives exist and why you didn't choose them

### Pre-push checklist

- [ ] No CLAUDE.md, harness.config.json, or harnext workflow files in the commit
- [ ] Commit message sounds human (short, lowercase, casual)
- [ ] Commit author is your name and email
- [ ] You made at least a few manual changes to the code
- [ ] You can explain every line if asked
- [ ] No "generated by" or "AI" references anywhere in code comments

---

## Internationalization (i18n)

- Library: react-i18next + i18next-browser-languagedetector
- Translations: bundled in frontend/src/i18n/locales/{lang}.json
- Supported locales: `en` (default fallback), `sk`. The runtime list is exported from `frontend/src/i18n/index.ts` as `SUPPORTED_LANGUAGES`; the NavBar pill switcher reads from it
- Persistence: choice is cached in `localStorage` under `tarmacview_language`; detection order is `localStorage` then `navigator`
- Key structure: nested by component/page - airportSelection.columns.name, auth.login
- Interpolation: t("key", { var: value }) with {{var}} in JSON
- Adding a language: create `frontend/src/i18n/locales/{lang}.json` with parity against `en.json`, import it in `src/i18n/index.ts`, register it in the `resources` map and append it to `SUPPORTED_LANGUAGES`. Aviation acronyms (RWY, TWY, PAPI, REL, AGL, LHA, MEHT, ICAO, CTR, MSL) stay in English across locales
- Plurals: i18next ICU shape - non-English locales may need extra forms (e.g. Slovak `_few` for 2-4 counts on `warning`, `violation`, `templatesCount`, `waypointsAffected`); locale-parity test pins the required keys
- Testing: global mock in setupTests.ts returns keys as values; `frontend/src/i18n/__tests__/locale-parity.test.ts` enforces key parity between locales
- Error strings: store flags/codes in state, translate at render time

### Form-field key trio

For labelled form fields, use three sibling keys under the field's namespace:

- `*Label` (or the bare field name, e.g. `transitAgl`) - short label rendered next to the input.
- `*Hint` - placeholder text shown inside the input when empty (e.g. "Default: 5.0 m/s").
- `*Help` - long-form tooltip surfaced by `InfoHint` next to the label (e.g. "Cruise speed used between waypoints..."). One or two sentences, full punctuation.

Example:

```json
"transitAgl": "Transit Height (m)",
"transitAglHint": "Minimum 5 m - leave empty for safe default",
"transitAglHelp": "Height above ground used for cruise legs between waypoints. Minimum 5 m. Changing this regresses the mission to DRAFT."
```

`*Hint` and `*Help` coexist - placeholder copy stays terse, tooltip copy explains the why.
