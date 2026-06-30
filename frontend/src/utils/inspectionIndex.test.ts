import { describe, it, expect } from "vitest";
import type { MissionDetailResponse } from "@/types/mission";
import { buildInspectionIndexMap } from "./inspectionIndex";

function mission(
  inspections: Array<{ id: string; sequence_order: number }>,
): MissionDetailResponse {
  return { inspections } as unknown as MissionDetailResponse;
}

describe("buildInspectionIndexMap", () => {
  it("returns undefined for a null mission", () => {
    expect(buildInspectionIndexMap(null)).toBeUndefined();
  });

  it("assigns a 1-based index sorted by sequence_order", () => {
    const map = buildInspectionIndexMap(
      mission([
        { id: "b", sequence_order: 2 },
        { id: "a", sequence_order: 1 },
        { id: "c", sequence_order: 3 },
      ]),
    );
    expect(map).toEqual({ a: 1, b: 2, c: 3 });
  });
});
