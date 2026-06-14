/** export-format capability matrix for the geozone-bundle flag.
 *
 * - GEOZONE_CAPABLE_FORMATS: formats that can carry keep-out polygons at all.
 * - GEOZONE_ENFORCED_FORMATS: native enforcement (the drone honors the polygons).
 * - GEOZONE_ADVISORY_FORMATS: rendered but not enforced (DJI Pilot 2 KML/KMZ).
 *
 * `canIncludeGeozones` returns the disabled-reason key the tooltip shows when
 * the parent checkbox is greyed out, so callers can render the right message
 * without re-implementing the matrix.
 */

export const GEOZONE_CAPABLE_FORMATS: ReadonlySet<string> = new Set([
  "MAVLINK",
  "JSON",
  "UGCS",
  "KMZ",
  "KML",
]);

export const GEOZONE_ENFORCED_FORMATS: ReadonlySet<string> = new Set([
  "MAVLINK",
  "JSON",
  "UGCS",
]);

export const GEOZONE_ADVISORY_FORMATS: ReadonlySet<string> = new Set([
  "KMZ",
  "KML",
]);

export interface CanIncludeGeozonesResult {
  enabled: boolean;
  reasonKey?: string;
}

export function canIncludeGeozones(
  formats: string[],
  drone?: { supports_geozone_upload?: boolean | null } | null,
): CanIncludeGeozonesResult {
  if (!formats || formats.length === 0) {
    return { enabled: false, reasonKey: "noFormatSelected" };
  }
  const anyCapable = formats.some((fmt) => GEOZONE_CAPABLE_FORMATS.has(fmt));
  if (!anyCapable) {
    return { enabled: false, reasonKey: "noCapableFormat" };
  }
  if (!drone) {
    return { enabled: false, reasonKey: "droneNotSelected" };
  }
  if (!drone.supports_geozone_upload) {
    return { enabled: false, reasonKey: "droneIncapable" };
  }
  return { enabled: true };
}
