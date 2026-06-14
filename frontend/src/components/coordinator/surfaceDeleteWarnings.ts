import type { SurfaceResponse } from "@/types/airport";

/** build cascade-delete warnings for a surface, shared by feature info and list panel. */
export function buildSurfaceDeleteWarnings(
  surface: SurfaceResponse,
  surfaces: SurfaceResponse[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string[] {
  const warnings: string[] = [];
  for (const a of surface.agls) {
    warnings.push(t("coordinator.detail.surfaceHasAgl", { name: a.name }));
  }
  if (surface.paired_surface_id) {
    const pair = surfaces.find((s) => s.id === surface.paired_surface_id);
    if (pair) {
      const totalAgls = surface.agls.length + pair.agls.length;
      warnings.push(
        t("coordinator.detail.surfacePair.deletePairWarning", {
          identifier: pair.identifier,
          count: totalAgls,
        }),
      );
    }
  }
  return warnings;
}
