# Vendored reference: runway-edge-light (REL) analysis experiment

This directory holds a **read-only reference snapshot** of the upstream REL
light-analysis experiment. It is NOT wired into the app and is NOT imported by any
production code. It exists so the REL measurement integration can be implemented
against the real source instead of a prose description, because the pipeline runners
only ever clone this repo and cannot reach the upstream working tree.

- **Upstream:** `github.com/vzeman/airport-lights-detection`
  (`experiments/drahove_svetla/analyze_runway_lights.py`)
- **Snapshot taken at upstream commit:** `4f60ae7` (the same snapshot the PAPI engine
  under `backend/app/services/video_processing/` was vendored from)
- **Source last modified upstream at:** `48287cd` (2026-02-07)
- **Files:**
  - `analyze_runway_lights.py` - the experiment, verbatim (1971 lines)
  - `PORTING-SPEC.md` - the plan for turning it into a wired REL measurement path

`drahove svetla` is Slovak for "runway edge lights".

## What it is

A standalone OpenCV + numpy experiment (`python analyze_runway_lights.py`) that takes
one drone fly-over video of a runway edge-light row and produces an interactive HTML
report plus an annotated video, scoring each light for faults. It is the REL analogue
of the vendored PAPI engine, but built as a single throwaway script: a hardcoded input
video path, `exiftool` shelled out for per-frame GPS/gimbal telemetry, JSON file caches
next to the script, and an `if __name__ == "__main__"` entry point.

## What it does (high level)

1. Pulls per-frame DJI telemetry (lat/lon, rel/abs altitude, gimbal angles, ISO,
   shutter, ...) via `exiftool -ee`.
2. Detects bright blobs per frame (grayscale threshold -> morphology -> contours),
   keeping an arbitrary number of candidate lights - there is no fixed light count and
   no `PAPI_A..D` naming.
3. Tracks each blob across frames into per-light tracks (greedy nearest-neighbour).
4. For each track, derives ground distance, signed along-track distance, and viewing
   angles from drone telemetry, then computes 30+ quality metrics (intensity vs
   distance, beam shape, CIE chromaticity / colour temperature, temporal jitter,
   spatial spacing / alignment, neighbour-relative intensity) and a 0-100 health score.

## Why it cannot just be switched on

It is structurally different from the wired PAPI engine on every axis - light identity,
core measurement, pass/fail basis, output shape, and integration surface. See
`PORTING-SPEC.md` for the gap analysis and the staged plan.

## Rules

- **Do not import, run, or lint this file as part of the app.** It lives under `docs/`
  precisely so ruff / pytest / the build never touch it. The hardcoded video path and
  the `exiftool` dependency are expected - this is a reference, not a module.
- **Do not edit it to "fix" it.** It is a faithful snapshot; the wired REL path is built
  fresh in `backend/app/services/video_processing/` per the porting spec, leaving this
  copy untouched as the ground-truth reference.
