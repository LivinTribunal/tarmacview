import type { InspectionMethod, MissionStatus } from "@/types/enums";

// mission-level limits mirrored from backend/app/models/mission.py.
// keep in sync with MAX_INSPECTIONS - the backend enforces the same cap
// and rejects writes above it.

export const MAX_INSPECTIONS = 10;

// fallback method when a template carries none / the operator has not picked one.
export const DEFAULT_INSPECTION_METHOD: InspectionMethod = "HORIZONTAL_RANGE";

// vertical-profile fallback band shown as placeholders when the operator has
// not entered angle_start / angle_end - mirrors the backend custom defaults.
export const VP_DEFAULT_START_DEG = 1.9;
export const VP_DEFAULT_END_DEG = 6.5;

// mission status ordering - a save that lands at a lower index than the
// previous status is a regression (e.g. PLANNED -> DRAFT after an edit).
export const STATUS_ORDER = [
  "DRAFT",
  "PLANNED",
  "VALIDATED",
  "EXPORTED",
  "MEASURED",
  "COMPLETED",
  "CANCELLED",
];

// terminal states - inspections cannot be modified once a mission is here.
export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED"];

// export/dispatch eligibility - mirrors backend Mission.EXPORT_ELIGIBLE_STATUSES.
// MEASURED is post-validation: the plan + artifacts persist so re-download /
// re-send stays allowed. COMPLETED / CANCELLED are terminal and excluded.
export const EXPORT_ELIGIBLE_STATUSES = ["VALIDATED", "EXPORTED", "MEASURED"];

export function isExportEligible(status: MissionStatus): boolean {
  return EXPORT_ELIGIBLE_STATUSES.includes(status);
}
