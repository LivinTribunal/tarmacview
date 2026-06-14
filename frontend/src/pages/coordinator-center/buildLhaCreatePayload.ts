import type { LHACreate } from "@/types/airport";

/** map creationform output to lhacreate dto, preserving null setting_angle for papi. */
export function buildLhaCreatePayload(
  data: Record<string, unknown>,
  position: [number, number],
): LHACreate {
  const alt = typeof data.altitude === "number" ? data.altitude : 0;
  return {
    unit_designator: (data.unit_designator as string) ?? "A",
    setting_angle: data.setting_angle as number | null,
    lamp_type: (data.lamp_type as "HALOGEN" | "LED") ?? "HALOGEN",
    position: { type: "Point", coordinates: [position[0], position[1], alt] },
    tolerance: data.tolerance != null ? (data.tolerance as number) : undefined,
    lens_height_msl_m: data.lens_height_msl_m as number | null | undefined,
    lens_height_agl_m: data.lens_height_agl_m as number | null | undefined,
  };
}
