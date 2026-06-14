# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

Single-context repo. Domain knowledge is split between a glossary (`CONTEXT.md`) and the existing spec/architecture docs under `docs/`.

```
/
├── CONTEXT.md              ← domain glossary (this repo's vocabulary)
├── CLAUDE.md               ← project conventions + DDD-Lite patterns
└── docs/
    ├── architecture.md     ← system architecture
    ├── conventions.md      ← coding standards, git workflow, OPSEC
    ├── layers.md           ← map layer reference
    ├── audit-trajectory-vs-zephyr.md
    ├── specs/
    │   ├── SPEC.md                   ← full domain model (19 tables, enums, formulas)
    │   ├── WIREFRAME.md              ← per-page UI specification
    │   ├── CHAPTER3-SYSTEM-DESIGN.md ← thesis chapter 3, authoritative design reference
    │   ├── DESIGN-SYSTEM.md          ← `--tv-*` CSS variables, design tokens
    │   ├── MAP-SYMBOLOGY.md
    │   ├── TRAJECTORY-CONTEXT.md
    │   ├── FIELD-HUB.md              ← field hub architecture (local DJI Cloud API gateway)
    │   ├── dji-cloud-api-reference.md ← DJI Cloud API protocol contract (field hub implementation)
    │   └── dji-wpml-reference.md     ← KMZ/WPML payload format reference
    └── adr/                ← dated, standalone decision records
```

## Before exploring, read these

Pick the smallest set that covers the area you're touching:

1. **`CONTEXT.md`** — always read first. It defines the domain vocabulary.
2. **`docs/specs/SPEC.md`** — the authoritative data model. Read whenever you're touching backend models, schemas, or anything that crosses the API boundary.
3. **`docs/specs/WIREFRAME.md`** — read when touching any frontend page.
4. **`docs/specs/CHAPTER3-SYSTEM-DESIGN.md`** — read for any architectural question.
5. **`docs/architecture.md`** — read when changing how the layers fit together.
6. **`docs/specs/TRAJECTORY-CONTEXT.md`** — read when touching `**/trajectory*` (T3 critical path).
7. **`docs/specs/DESIGN-SYSTEM.md`** — read before writing or styling any frontend component (must use `--tv-*` variables).
8. **`docs/specs/FIELD-HUB.md`** — read when touching mission dispatch, field-link status, or drone-media work (field hub architecture + per-phase landed status; companion ADR in `docs/adr/`).
9. **`docs/specs/dji-cloud-api-reference.md`** — read when implementing field-hub protocol work (device binding, wayline dispatch, media return, the Pilot 2 webview connect page). The DJI endpoints, MQTT topics, and payload shapes are inline there — it's the single protocol source of truth; pipeline agents have no web access.
10. **`docs/adr/`** — read the dated decision records that touch the area you're working in. Foundational inline ADRs (serverless deployment, WKT-as-text geometry) live in `docs/architecture.md`.

## Use the glossary's vocabulary

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name), use the term as defined in `CONTEXT.md` and `docs/specs/SPEC.md`. Don't drift to synonyms.

If the concept you need isn't documented yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it).

## Flag conflicts with existing decisions

If your output contradicts something in `docs/specs/SPEC.md`, `CHAPTER3-SYSTEM-DESIGN.md`, or an ADR, surface it explicitly rather than silently overriding:

> _Contradicts SPEC § "Mission status state machine" — but worth reopening because…_
