import type { AglType } from "@/types/airport";
import type { InspectionMethod } from "@/types/enums";

// inspection method -> set of compatible AGL types
// hover point lock and surface scan are AGL-agnostic (hover point lock targets
// an LHA center, surface scan targets a surface) - empty list joins them into
// AGL_AGNOSTIC_METHODS below.
export const METHOD_AGL_COMPAT: Record<InspectionMethod, AglType[]> = {
  VERTICAL_PROFILE: ["PAPI"],
  HORIZONTAL_RANGE: ["PAPI"],
  APPROACH_DESCENT: ["PAPI"],
  HOVER_POINT_LOCK: [],
  SURFACE_SCAN: [],
  FLY_OVER: ["RUNWAY_EDGE_LIGHTS"],
  PARALLEL_SIDE_SWEEP: ["RUNWAY_EDGE_LIGHTS"],
  MEHT_CHECK: ["PAPI"],
  RUNWAY_HORIZONTAL_RANGE: ["RUNWAY_EDGE_LIGHTS"],
};

// per-method UI capability flags - drives which inspection-config inputs and
// method-specific form section render, so adding a method means one new row here
// rather than threading it through scattered conditionals. exhaustive over
// InspectionMethod (same compile-time contract as METHOD_AGL_COMPAT above).
export interface MethodCaps {
  // flight-parameters inputs
  usesMeasurementSpeed: boolean;
  usesDensity: boolean;
  usesHover: boolean;
  // direction-flip widget visibility
  usesDirection: boolean;
  // lha picker vs surface target
  target: "LHA" | "SURFACE";
  // slot the method's own FormSection renders in (MethodSpecificSections);
  // null when the method has no section of its own - vertical-profile and
  // horizontal-range drive the geometry-override grid instead.
  formSlot: "geometry" | "trailing" | null;
}

export const METHOD_CAPABILITIES: Record<InspectionMethod, MethodCaps> = {
  VERTICAL_PROFILE: {
    usesMeasurementSpeed: true,
    usesDensity: true,
    usesHover: true,
    usesDirection: false,
    target: "LHA",
    formSlot: null,
  },
  HORIZONTAL_RANGE: {
    usesMeasurementSpeed: true,
    usesDensity: true,
    usesHover: true,
    usesDirection: true,
    target: "LHA",
    formSlot: null,
  },
  APPROACH_DESCENT: {
    usesMeasurementSpeed: true,
    usesDensity: true,
    usesHover: true,
    usesDirection: false,
    target: "LHA",
    formSlot: "geometry",
  },
  HOVER_POINT_LOCK: {
    usesMeasurementSpeed: false,
    usesDensity: false,
    usesHover: true,
    usesDirection: false,
    target: "LHA",
    formSlot: "trailing",
  },
  SURFACE_SCAN: {
    usesMeasurementSpeed: true,
    usesDensity: false,
    usesHover: false,
    usesDirection: true,
    target: "SURFACE",
    formSlot: "trailing",
  },
  FLY_OVER: {
    usesMeasurementSpeed: true,
    usesDensity: true,
    usesHover: true,
    usesDirection: true,
    target: "LHA",
    formSlot: "geometry",
  },
  PARALLEL_SIDE_SWEEP: {
    usesMeasurementSpeed: true,
    usesDensity: true,
    usesHover: true,
    usesDirection: true,
    target: "LHA",
    formSlot: "geometry",
  },
  MEHT_CHECK: {
    usesMeasurementSpeed: false,
    usesDensity: false,
    usesHover: true,
    usesDirection: false,
    target: "LHA",
    formSlot: "trailing",
  },
  RUNWAY_HORIZONTAL_RANGE: {
    usesMeasurementSpeed: true,
    usesDensity: true,
    usesHover: true,
    usesDirection: true,
    target: "LHA",
    formSlot: "geometry",
  },
};

// all methods by AGL type (useful for the 2-step picker)
export const METHODS_BY_AGL: Record<AglType, InspectionMethod[]> = {
  PAPI: ["VERTICAL_PROFILE", "HORIZONTAL_RANGE", "APPROACH_DESCENT", "MEHT_CHECK"],
  RUNWAY_EDGE_LIGHTS: [
    "FLY_OVER",
    "PARALLEL_SIDE_SWEEP",
    "RUNWAY_HORIZONTAL_RANGE",
  ],
};

// derived from METHOD_AGL_COMPAT so a new method only needs the one entry above -
// the dropdown stays in sync via the record's exhaustiveness check.
export const ALL_INSPECTION_METHODS = Object.keys(
  METHOD_AGL_COMPAT,
) as InspectionMethod[];

// agl-agnostic == no compatible AGL types (operator picks the LHA per mission)
export const AGL_AGNOSTIC_METHODS = (
  Object.entries(METHOD_AGL_COMPAT) as [InspectionMethod, AglType[]][]
).flatMap(([m, types]) => (types.length === 0 ? [m] : []));

/** true when the inspection method can target the given AGL type. */
export function isMethodCompatibleWithAgl(
  method: InspectionMethod,
  agl: AglType,
): boolean {
  const allowed = METHOD_AGL_COMPAT[method];
  return allowed ? allowed.includes(agl) : false;
}

/** inspection methods applicable to an AGL type. */
export function methodsForAgl(agl: AglType): InspectionMethod[] {
  return METHODS_BY_AGL[agl] ?? [];
}

/** AGL types a given inspection method can target. */
export function aglTypesForMethod(method: InspectionMethod): AglType[] {
  return METHOD_AGL_COMPAT[method] ?? [];
}

/** UI capability flags for an inspection method. */
export function methodCaps(method: InspectionMethod): MethodCaps {
  return METHOD_CAPABILITIES[method];
}

/** filter an allowed-methods list (e.g. template.methods) to those compatible
 * with every AGL type in `agls`.
 */
export function compatibleMethods(
  methods: InspectionMethod[],
  agls: AglType[],
): InspectionMethod[] {
  return methods.filter((m) =>
    agls.every((a) => isMethodCompatibleWithAgl(m, a)),
  );
}
