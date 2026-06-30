import type { MissionDetailResponse } from "@/types/mission";

/** 1-based inspection-id -> sequence index, sorted by sequence_order. */
export function buildInspectionIndexMap(
  mission: MissionDetailResponse | null,
): Record<string, number> | undefined {
  if (!mission) return undefined;
  const sorted = mission.inspections
    .slice()
    .sort((a, b) => a.sequence_order - b.sequence_order);
  return Object.fromEntries(sorted.map((insp, i) => [insp.id, i + 1]));
}
