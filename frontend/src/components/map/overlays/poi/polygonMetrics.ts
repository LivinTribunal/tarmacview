import type { PolygonZ } from "@/types/common";

/** compute polygon area (shoelace, equirectangular) and perimeter (haversine). */
export function computePolygonAreaPerimeter(polygon: PolygonZ | null | undefined): {
  areaM2: number;
  perimeterM: number;
} {
  if (!polygon || !polygon.coordinates || !polygon.coordinates[0]) {
    return { areaM2: 0, perimeterM: 0 };
  }
  const ring = polygon.coordinates[0];
  if (ring.length < 3) return { areaM2: 0, perimeterM: 0 };

  const R = 6378137;
  const toRad = (d: number) => (d * Math.PI) / 180;

  // haversine perimeter
  let perimeter = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    perimeter += 2 * R * Math.asin(Math.sqrt(a));
  }

  // shoelace area on equirectangular projection centered at ring centroid
  const latSum = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const cosLat = Math.cos(toRad(latSum));
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = toRad(ring[i][0]) * R * cosLat;
    const y1 = toRad(ring[i][1]) * R;
    const x2 = toRad(ring[i + 1][0]) * R * cosLat;
    const y2 = toRad(ring[i + 1][1]) * R;
    area += x1 * y2 - x2 * y1;
  }
  return { areaM2: Math.abs(area) / 2, perimeterM: perimeter };
}

/** format area in m² or km² depending on magnitude. */
export function formatArea(
  m2: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (m2 >= 1_000_000) {
    return `${(m2 / 1_000_000).toFixed(2)} ${t("common.units.km2", { defaultValue: "km²" })}`;
  }
  return `${Math.round(m2)} ${t("common.units.m2", { defaultValue: "m²" })}`;
}

/** format length in meters or kilometers. */
export function formatLength(
  m: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (m >= 1000) {
    return `${(m / 1000).toFixed(2)} ${t("common.units.km", { defaultValue: "km" })}`;
  }
  return `${Math.round(m)} ${t("common.units.m")}`;
}
