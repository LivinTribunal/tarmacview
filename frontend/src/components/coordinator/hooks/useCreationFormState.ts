import { useState, useMemo, useEffect } from "react";
import type { TFunction } from "i18next";
import type {
  SurfaceResponse,
  AGLResponse,
  ObstacleResponse,
  SafetyZoneResponse,
} from "@/types/airport";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";
import { roundCoord, roundAlt } from "@/utils/coordRounding";
import { alongRunwayDistanceFromThreshold } from "@/utils/aglDistance";
import { useResolvedAltitude } from "@/hooks/useResolvedAltitude";
import {
  DEFAULT_BUFFER_DISTANCE,
  DEFAULT_GLIDE_SLOPE_ANGLE,
  DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE,
  DEFAULT_ILS_HARMONIZATION_TOLERANCE,
  DEFAULT_LHA_SETTING_ANGLE,
  DEFAULT_LHA_TOLERANCE,
} from "@/constants/infrastructureDefaults";
import {
  CIRCLE_CATEGORIES,
  OBSTACLE_SUBTYPES,
  POINT_CATEGORIES,
  POLYGON_CATEGORIES,
  SAFETY_ZONE_SUBTYPES,
  SAFETY_ZONE_TYPE_MAP,
  type Category,
  type EntityType,
  type PendingGeometryType,
} from "../utils/creationFormConstants";

export interface CreationFormProps {
  geometryType: PendingGeometryType;
  circleRadius?: number;
  circleCenter?: [number, number];
  pointPosition?: [number, number];
  surfaces: SurfaceResponse[];
  onCancel: () => void;
  onCreate: (entityType: EntityType, data: Record<string, unknown>) => Promise<void>;
  prefilledWidth?: number;
  prefilledLength?: number;
  prefilledHeading?: number;
  prefilledArea?: number;
  // drawn centerline endpoints (start, end), used to seed runway threshold/end pick.
  centerlineEndpoints?: [[number, number], [number, number]];
  obstacles?: ObstacleResponse[];
  safetyZones?: SafetyZoneResponse[];
  airportElevation?: number;
  prefilledEntityType?: EntityType;
  pickingTouchpoint?: boolean;
  onPickTouchpointToggle?: () => void;
  pickedTouchpointCoord?: { lat: number; lon: number; alt: number } | null;
  onPickedTouchpointConsumed?: () => void;
  pickingThreshold?: boolean;
  onPickThresholdToggle?: () => void;
  pickedThresholdCoord?: { lat: number; lon: number; alt: number } | null;
  onPickedThresholdConsumed?: () => void;
  pickingEnd?: boolean;
  onPickEndToggle?: () => void;
  pickedEndCoord?: { lat: number; lon: number; alt: number } | null;
  onPickedEndConsumed?: () => void;
  resolver?: ElevationResolver;
  // PAPI lens heights seeded from an image-extractor handoff (msl / agl).
  prefilledLensHeightMslM?: number | null;
  prefilledLensHeightAglM?: number | null;
}

/** state machine for the creation form - field state, prefill effects, derived predicates, submit. */
export function useCreationFormState(props: CreationFormProps, t: TFunction) {
  const {
    geometryType,
    circleCenter,
    pointPosition,
    surfaces,
    onCreate,
    prefilledWidth,
    prefilledLength,
    prefilledHeading,
    centerlineEndpoints,
    obstacles = [],
    safetyZones = [],
    airportElevation = 0,
    prefilledEntityType,
    pickedTouchpointCoord,
    onPickedTouchpointConsumed,
    pickedThresholdCoord,
    onPickedThresholdConsumed,
    pickedEndCoord,
    onPickedEndConsumed,
    resolver,
    prefilledLensHeightMslM,
    prefilledLensHeightAglM,
  } = props;

  const initialCategory: Category | "" = prefilledEntityType?.startsWith("safety_zone_")
    ? "safety_zone"
    : prefilledEntityType === "runway" || prefilledEntityType === "taxiway"
      ? "surface"
      : prefilledEntityType === "obstacle"
        ? "obstacle"
        : prefilledEntityType === "agl"
          ? "agl"
          : prefilledEntityType === "lha"
            ? "lha"
            : "";
  const [category, setCategory] = useState<Category | "">(initialCategory);
  const [entityType, setEntityType] = useState<EntityType | "">(prefilledEntityType ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form field state
  const [name, setName] = useState("");
  const [heading, setHeading] = useState(prefilledHeading != null ? String(Math.round(prefilledHeading * 10) / 10) : "");
  const [length, setLength] = useState(prefilledLength != null ? String(roundAlt(prefilledLength)) : "");
  const [width, setWidth] = useState(prefilledWidth != null ? String(roundAlt(prefilledWidth)) : "");
  const [altFloor, setAltFloor] = useState("0");
  const [altCeiling, setAltCeiling] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [obstacleType, setObstacleType] = useState("BUILDING");
  const [obstacleHeight, setObstacleHeight] = useState("");
  const [bufferDistance, setBufferDistance] = useState(DEFAULT_BUFFER_DISTANCE);
  const [aglType, setAglType] = useState<"PAPI" | "RUNWAY_EDGE_LIGHTS">("PAPI");
  const [aglSide, setAglSide] = useState("LEFT");
  const [glideSlopeAngle, setGlideSlopeAngle] = useState(DEFAULT_GLIDE_SLOPE_ANGLE);
  const [glideSlopeAngleTolerance, setGlideSlopeAngleTolerance] = useState(
    DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE,
  );
  const [ilsHarmonizationTolerance, setIlsHarmonizationTolerance] = useState(
    DEFAULT_ILS_HARMONIZATION_TOLERANCE,
  );
  const [distFromThreshold, setDistFromThreshold] = useState("");
  const [surfaceId, setSurfaceId] = useState(surfaces.length > 0 ? surfaces[0].id : "");

  // runway touchpoint fields
  const [touchpointLat, setTouchpointLat] = useState("");
  const [touchpointLon, setTouchpointLon] = useState("");
  const [touchpointAlt, setTouchpointAlt] = useState("");

  // runway threshold/end editable inputs - seeded from the drawn centerline,
  // overridable by the operator.
  const [thresholdLat, setThresholdLat] = useState(
    centerlineEndpoints ? String(roundCoord(centerlineEndpoints[0][1])) : "",
  );
  const [thresholdLon, setThresholdLon] = useState(
    centerlineEndpoints ? String(roundCoord(centerlineEndpoints[0][0])) : "",
  );
  const [thresholdAlt, setThresholdAlt] = useState(
    airportElevation ? String(roundAlt(airportElevation)) : "",
  );
  const [endLat, setEndLat] = useState(
    centerlineEndpoints ? String(roundCoord(centerlineEndpoints[1][1])) : "",
  );
  const [endLon, setEndLon] = useState(
    centerlineEndpoints ? String(roundCoord(centerlineEndpoints[1][0])) : "",
  );
  const [endAlt, setEndAlt] = useState(
    airportElevation ? String(roundAlt(airportElevation)) : "",
  );

  // re-seed threshold/end whenever the drawn centerline changes so a fresh draw
  // always defaults to "vertex 0 = threshold". keyed on scalar coordinates so
  // a stable centerline (same vertices, fresh array reference) does not reset.
  const centerlineKey = centerlineEndpoints
    ? `${centerlineEndpoints[0][0]},${centerlineEndpoints[0][1]}|${centerlineEndpoints[1][0]},${centerlineEndpoints[1][1]}`
    : "";
  useEffect(() => {
    if (!centerlineEndpoints) return;
    setThresholdLat(String(roundCoord(centerlineEndpoints[0][1])));
    setThresholdLon(String(roundCoord(centerlineEndpoints[0][0])));
    setEndLat(String(roundCoord(centerlineEndpoints[1][1])));
    setEndLon(String(roundCoord(centerlineEndpoints[1][0])));
    const fallback = airportElevation ? String(roundAlt(airportElevation)) : "";
    setThresholdAlt(fallback);
    setEndAlt(fallback);
  }, [centerlineKey]);

  function swapThresholdEnd() {
    /** swap the threshold and end lat/lon/alt triples. */
    setThresholdLat(endLat);
    setThresholdLon(endLon);
    setThresholdAlt(endAlt);
    setEndLat(thresholdLat);
    setEndLon(thresholdLon);
    setEndAlt(thresholdAlt);
  }

  // distFromThreshold has its own user-edit freeze so a manual override
  // survives later lat/lon / runway changes
  const [distEdited, setDistEdited] = useState(false);

  // lha fields
  const [lhaAglId, setLhaAglId] = useState("");
  const [lhaSettingAngle, setLhaSettingAngle] = useState(DEFAULT_LHA_SETTING_ANGLE);
  const [lhaLampType, setLhaLampType] = useState("HALOGEN");
  const [lhaTolerance, setLhaTolerance] = useState("");

  // PAPI lens heights (msl / agl), seeded from an extractor handoff. re-seed on
  // every handoff change so the queued-point flow refreshes per unit.
  const [lhaLensMsl, setLhaLensMsl] = useState(
    prefilledLensHeightMslM != null ? String(prefilledLensHeightMslM) : "",
  );
  const [lhaLensAgl, setLhaLensAgl] = useState(
    prefilledLensHeightAglM != null ? String(prefilledLensHeightAglM) : "",
  );
  useEffect(() => {
    setLhaLensMsl(prefilledLensHeightMslM != null ? String(prefilledLensHeightMslM) : "");
    setLhaLensAgl(prefilledLensHeightAglM != null ? String(prefilledLensHeightAglM) : "");
  }, [prefilledLensHeightMslM, prefilledLensHeightAglM]);

  // collect all agls from surfaces
  const allAgls = useMemo(() => {
    const agls: (AGLResponse & { surfaceId: string })[] = [];
    for (const s of surfaces) {
      for (const a of s.agls) {
        agls.push({ ...a, surfaceId: s.id });
      }
    }
    return agls;
  }, [surfaces]);

  // next available designator based on selected agl
  const selectedAgl = useMemo(() => allAgls.find((a) => a.id === lhaAglId), [lhaAglId, allAgls]);
  const isPapiAgl = selectedAgl?.agl_type === "PAPI";
  const nextDesignator = useMemo(() => {
    if (!selectedAgl) return "A";
    if (isPapiAgl) {
      const used = new Set(selectedAgl.lhas.map((l) => l.unit_designator));
      return ["A", "B", "C", "D"].find((d) => !used.has(d)) ?? null;
    }
    const nums = selectedAgl.lhas.reduce<number[]>((acc, l) => {
      const n = parseInt(l.unit_designator, 10);
      if (!isNaN(n)) acc.push(n);
      return acc;
    }, []);
    return String(nums.length > 0 ? Math.max(...nums) + 1 : 1);
  }, [selectedAgl, isPapiAgl]);
  const papiSlotsExhausted = isPapiAgl && nextDesignator === null;

  // manual coordinate entry for point entities (AGL/LHA/obstacle from circle/point)
  const [manualLat, setManualLat] = useState(pointPosition ? String(pointPosition[1]) : "");
  const [manualLon, setManualLon] = useState(pointPosition ? String(pointPosition[0]) : "");

  // sync map clicks into manual fields
  useEffect(() => {
    if (pointPosition) {
      setManualLat(String(pointPosition[1]));
      setManualLon(String(pointPosition[0]));
    }
  }, [pointPosition]);

  // consume picked touchpoint coordinate from map click
  useEffect(() => {
    if (pickedTouchpointCoord) {
      setTouchpointLat(String(roundCoord(pickedTouchpointCoord.lat)));
      setTouchpointLon(String(roundCoord(pickedTouchpointCoord.lon)));
      setTouchpointAlt(String(roundAlt(pickedTouchpointCoord.alt)));
      onPickedTouchpointConsumed?.();
    }
  }, [pickedTouchpointCoord, onPickedTouchpointConsumed]);

  // consume picked threshold/end coords from creation-mode map clicks
  useEffect(() => {
    if (pickedThresholdCoord) {
      setThresholdLat(String(roundCoord(pickedThresholdCoord.lat)));
      setThresholdLon(String(roundCoord(pickedThresholdCoord.lon)));
      setThresholdAlt(String(roundAlt(pickedThresholdCoord.alt)));
      onPickedThresholdConsumed?.();
    }
  }, [pickedThresholdCoord, onPickedThresholdConsumed]);

  useEffect(() => {
    if (pickedEndCoord) {
      setEndLat(String(roundCoord(pickedEndCoord.lat)));
      setEndLon(String(roundCoord(pickedEndCoord.lon)));
      setEndAlt(String(roundAlt(pickedEndCoord.alt)));
      onPickedEndConsumed?.();
    }
  }, [pickedEndCoord, onPickedEndConsumed]);

  // auto-prefill surface identifier as a plain numeric counter; operators
  // strip the historic "RWY "/"TWY " literal anyway, and the surface_type
  // column already records runway-vs-taxiway.
  useEffect(() => {
    if (category !== "surface" || !entityType) return;
    const surfaceType = entityType === "runway" ? "RUNWAY" : "TAXIWAY";
    const count = surfaces.filter((s) => s.surface_type === surfaceType).length;
    setName(String(count + 1));
  }, [entityType, category]); // surfaces intentionally excluded - only prefill on type change

  // auto-prefill obstacle name based on type + count
  useEffect(() => {
    if (category !== "obstacle") return;
    const count = obstacles.filter((o) => o.type === obstacleType).length;
    const sub = OBSTACLE_SUBTYPES.find((s) => s.value === obstacleType);
    const label = sub ? t(sub.labelKey) : obstacleType;
    setName(`${label} ${count + 1}`);
  }, [obstacleType, category, t]); // obstacles intentionally excluded - only prefill on type change

  // auto-prefill AGL name based on connected surface and type. AGL names
  // include the RWY/TWY token so the lighting label reads naturally on its
  // own (e.g. "REL RWY 09L"); surface names stay token-free since the
  // surface_type column already records runway-vs-taxiway.
  useEffect(() => {
    if (category !== "agl") return;
    const surface = surfaces.find((s) => s.id === surfaceId);
    const typeLabel = aglType === "RUNWAY_EDGE_LIGHTS" ? "REL" : "PAPI";
    if (surface) {
      const prefix = surface.surface_type === "RUNWAY" ? "RWY" : "TWY";
      setName(`${typeLabel} ${prefix} ${surface.identifier}`);
    } else {
      setName(typeLabel);
    }
  }, [surfaceId, category, surfaces, aglType]);

  // auto-prefill LHA name
  useEffect(() => {
    if (category !== "lha" || !lhaAglId || nextDesignator === null) return;
    setName(`LHA Unit ${nextDesignator}`);
  }, [lhaAglId, category, nextDesignator]);

  // pre-fill lha fields from most recent lha on the selected agl.
  // position intentionally stays blank - user places each lha on the map.
  useEffect(() => {
    if (category !== "lha" || !lhaAglId) return;
    const agl = allAgls.find((a) => a.id === lhaAglId);
    if (!agl) return;
    const sorted = agl.lhas.slice().sort((a, b) => {
      const an = parseInt(a.unit_designator, 10);
      const bn = parseInt(b.unit_designator, 10);
      return !isNaN(an) && !isNaN(bn) ? an - bn : a.unit_designator.localeCompare(b.unit_designator);
    });
    const recent = sorted[sorted.length - 1];
    if (recent) {
      setLhaTolerance(recent.tolerance != null ? String(recent.tolerance) : DEFAULT_LHA_TOLERANCE);
      setLhaLampType(recent.lamp_type);
      if (agl.agl_type === "PAPI") {
        setLhaSettingAngle("");
      } else {
        setLhaSettingAngle(recent.setting_angle != null ? String(recent.setting_angle) : "");
      }
    } else {
      setLhaTolerance(DEFAULT_LHA_TOLERANCE);
      setLhaLampType("HALOGEN");
      setLhaSettingAngle(agl.agl_type === "PAPI" ? "" : "0.0");
    }
  }, [lhaAglId, allAgls, category]);

  const categoryOptions = geometryType === "circle"
    ? CIRCLE_CATEGORIES
    : geometryType === "point"
      ? POINT_CATEGORIES
      : POLYGON_CATEGORIES;

  function handleCategoryChange(value: string) {
    /** update category and reset entity type. */
    setCategory(value as Category);
    setEntityType("");
  }

  // determine effective entity type - some categories map directly
  const effectiveEntityType: EntityType | "" = (() => {
    if (category === "obstacle") return "obstacle";
    if (category === "agl") return "agl";
    if (category === "lha") return "lha";
    return entityType;
  })();

  // point-entity altitude input is shown for agl, lha, and single-point obstacles
  const obstacleHasSinglePoint =
    effectiveEntityType === "obstacle" && (Boolean(circleCenter) || Boolean(pointPosition));
  const showAltInput =
    effectiveEntityType === "agl" || effectiveEntityType === "lha" || obstacleHasSinglePoint;

  // lat/lon used to drive the elevation lookup, by entity type
  const altResolveLat: number | null = (() => {
    if (effectiveEntityType === "agl" || effectiveEntityType === "lha") {
      const v = parseFloat(manualLat);
      return isNaN(v) ? null : v;
    }
    if (obstacleHasSinglePoint) {
      const c = circleCenter ?? pointPosition;
      return c ? c[1] : null;
    }
    return null;
  })();
  const altResolveLon: number | null = (() => {
    if (effectiveEntityType === "agl" || effectiveEntityType === "lha") {
      const v = parseFloat(manualLon);
      return isNaN(v) ? null : v;
    }
    if (obstacleHasSinglePoint) {
      const c = circleCenter ?? pointPosition;
      return c ? c[0] : null;
    }
    return null;
  })();

  const { manualAlt, altLoading, altFallback, handleAltChange } = useResolvedAltitude({
    effectiveEntityType,
    showAltInput,
    altResolveLat,
    altResolveLon,
    resolver,
    airportElevation,
  });

  // resolved runway threshold/end (lon, lat) derived from the editable inputs.
  // null while any of the four fields is missing or unparseable.
  const resolvedThresholdEnd = useMemo<{
    threshold: [number, number];
    end: [number, number];
  } | null>(() => {
    const tLat = parseFloat(thresholdLat);
    const tLon = parseFloat(thresholdLon);
    const eLat = parseFloat(endLat);
    const eLon = parseFloat(endLon);
    if ([tLat, tLon, eLat, eLon].some((n) => isNaN(n))) return null;
    return { threshold: [tLon, tLat], end: [eLon, eLat] };
  }, [thresholdLat, thresholdLon, endLat, endLon]);

  // live-prefill distFromThreshold for AGL creation. mirrors the server-side
  // _along_runway_distance_from_threshold so the operator sees the same value
  // the backend would persist. frozen once the operator types in the field.
  const selectedAglSurface = useMemo(
    () => surfaces.find((s) => s.id === surfaceId),
    [surfaces, surfaceId],
  );
  const autoDistFromThreshold = useMemo(() => {
    if (category !== "agl") return null;
    const surface = selectedAglSurface;
    if (!surface) return null;
    const thr = surface.threshold_position?.coordinates;
    const end = surface.end_position?.coordinates;
    if (!thr || !end) return null;
    const latNum = parseFloat(manualLat);
    const lonNum = parseFloat(manualLon);
    if (isNaN(latNum) || isNaN(lonNum)) return null;
    return alongRunwayDistanceFromThreshold(
      [thr[0], thr[1]],
      [end[0], end[1]],
      lonNum,
      latNum,
    );
  }, [category, selectedAglSurface, manualLat, manualLon]);

  // reset the dist-edited freeze when category/surface flips (new entity, fresh prefill)
  useEffect(() => {
    setDistEdited(false);
  }, [category, surfaceId]);

  useEffect(() => {
    if (distEdited) return;
    if (autoDistFromThreshold == null) return;
    setDistFromThreshold(String(roundAlt(autoDistFromThreshold)));
  }, [autoDistFromThreshold, distEdited]);

  function handleDistFromThresholdChange(value: string) {
    /** operator typed in dist field - freeze it from later auto-prefills. */
    setDistFromThreshold(value);
    setDistEdited(true);
  }

  // whether a subtype dropdown is needed
  const needsSubtype = category === "surface" || category === "safety_zone";

  async function handleSubmit() {
    /** validate and submit the creation form. */
    if (!effectiveEntityType || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const data: Record<string, unknown> = { name: name.trim() };

      if (effectiveEntityType === "runway" || effectiveEntityType === "taxiway") {
        if (heading) data.heading = parseFloat(heading);
        if (length) data.length = parseFloat(length);
        if (width) data.width = parseFloat(width);
      }

      if (effectiveEntityType === "runway") {
        const tpLat = parseFloat(touchpointLat);
        const tpLon = parseFloat(touchpointLon);
        const tpAlt = parseFloat(touchpointAlt);
        if (!isNaN(tpLat)) data.touchpoint_latitude = tpLat;
        if (!isNaN(tpLon)) data.touchpoint_longitude = tpLon;
        if (!isNaN(tpAlt)) data.touchpoint_altitude = tpAlt;

        // emit threshold/end as WKT POINT Z so the backend can persist them
        // alongside the centerline geometry; the pair-swap path mirrors them
        // on reverse-runway creation. each side carries its own editable alt;
        // a blank input falls back to airport elevation.
        if (resolvedThresholdEnd) {
          const [thrLon, thrLat] = resolvedThresholdEnd.threshold;
          const [eLon, eLat] = resolvedThresholdEnd.end;
          const thrAltNum = parseFloat(thresholdAlt);
          const endAltNum = parseFloat(endAlt);
          const thrAltZ = isNaN(thrAltNum) ? airportElevation : thrAltNum;
          const endAltZ = isNaN(endAltNum) ? airportElevation : endAltNum;
          data.threshold_position = `POINT Z (${thrLon} ${thrLat} ${thrAltZ})`;
          data.end_position = `POINT Z (${eLon} ${eLat} ${endAltZ})`;
        }
      }

      if (effectiveEntityType.startsWith("safety_zone_")) {
        if (effectiveEntityType !== "safety_zone_airport_boundary") {
          data.altitude_floor = altFloor ? parseFloat(altFloor) : 0;
          if (altCeiling) data.altitude_ceiling = parseFloat(altCeiling);
          data.is_active = isActive;
        }
      }

      if (effectiveEntityType === "obstacle") {
        data.type = obstacleType;
        if (obstacleHeight) data.height = parseFloat(obstacleHeight);
        data.buffer_distance = bufferDistance
          ? parseFloat(bufferDistance)
          : parseFloat(DEFAULT_BUFFER_DISTANCE);
        if (circleCenter) data.center = circleCenter;
        else if (pointPosition) data.center = pointPosition;
        if (obstacleHasSinglePoint) {
          const altNum = parseFloat(manualAlt);
          data.altitude = isNaN(altNum) ? airportElevation : altNum;
        }
      }

      if (effectiveEntityType === "agl") {
        data.agl_type = aglType;
        data.side = aglSide;
        // glide slope is a PAPI-only concept (defined approach beam); edge lights have no vertical guidance
        if (aglType === "PAPI" && glideSlopeAngle) {
          data.glide_slope_angle = parseFloat(glideSlopeAngle);
        }
        if (aglType === "PAPI" && glideSlopeAngleTolerance) {
          data.glide_slope_angle_tolerance = parseFloat(glideSlopeAngleTolerance);
        }
        if (aglType === "PAPI" && ilsHarmonizationTolerance) {
          data.ils_harmonization_tolerance = parseFloat(ilsHarmonizationTolerance);
        }
        if (distFromThreshold) data.distance_from_threshold = parseFloat(distFromThreshold);
        data.surface_id = surfaceId;
        const lat = parseFloat(manualLat);
        const lon = parseFloat(manualLon);
        if (!isNaN(lat) && !isNaN(lon)) data.center = [lon, lat];
        const altNum = parseFloat(manualAlt);
        data.altitude = isNaN(altNum) ? airportElevation : altNum;
      }

      if (effectiveEntityType === "lha") {
        data.agl_id = lhaAglId;
        data.unit_designator = nextDesignator;
        // parent agl type decides whether a blank setting_angle is allowed (PAPI -> null)
        const parentAgl = allAgls.find((a) => a.id === lhaAglId);
        if (lhaSettingAngle) {
          data.setting_angle = parseFloat(lhaSettingAngle);
        } else if (parentAgl?.agl_type === "PAPI") {
          data.setting_angle = null;
        } else {
          data.setting_angle = 0.0;
        }
        data.lamp_type = lhaLampType;
        if (lhaTolerance) data.tolerance = parseFloat(lhaTolerance);
        const lat = parseFloat(manualLat);
        const lon = parseFloat(manualLon);
        if (!isNaN(lat) && !isNaN(lon)) data.center = [lon, lat];
        const altNum = parseFloat(manualAlt);
        data.altitude = isNaN(altNum) ? airportElevation : altNum;
        // lens heights are a PAPI-only concept; null for edge lights.
        if (parentAgl?.agl_type === "PAPI") {
          const mslNum = parseFloat(lhaLensMsl);
          const aglNum = parseFloat(lhaLensAgl);
          data.lens_height_msl_m = isNaN(mslNum) ? null : mslNum;
          data.lens_height_agl_m = isNaN(aglNum) ? null : aglNum;
        }
      }

      await onCreate(effectiveEntityType, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("coordinator.creation.createError"));
    } finally {
      setSubmitting(false);
    }
  }

  const isSafetyZone = effectiveEntityType.startsWith("safety_zone_");
  const isAirportBoundary = effectiveEntityType === "safety_zone_airport_boundary";
  const prefilledBoundary = prefilledEntityType === "safety_zone_airport_boundary";

  // auto-prefill default name when switching into airport boundary
  useEffect(() => {
    if (isAirportBoundary && !name.trim()) {
      setName(t("boundary.airportBoundary"));
    }
  }, [isAirportBoundary, name, t]);

  // auto-prefill safety zone name based on zone type + count
  useEffect(() => {
    if (!isSafetyZone || isAirportBoundary) return;
    const zoneType = SAFETY_ZONE_TYPE_MAP[effectiveEntityType] ?? effectiveEntityType;
    const sub = SAFETY_ZONE_SUBTYPES.find((s) => s.value === effectiveEntityType);
    const label = sub ? t(sub.labelKey) : zoneType;
    const count = safetyZones.filter((z) => z.type === zoneType).length;
    setName(`${label} ${count + 1}`);
  }, [effectiveEntityType, t, isSafetyZone, isAirportBoundary]); // safetyZones intentionally excluded - only prefill on type change

  // auto-prefill safety zone altitude floor from airport elevation
  useEffect(() => {
    if (!isSafetyZone || isAirportBoundary) return;
    if (airportElevation > 0) {
      setAltFloor(String(Math.round(airportElevation)));
    }
  }, [isSafetyZone, isAirportBoundary, airportElevation]);

  function namePlaceholder(): string {
    /** get the right placeholder for the name field. */
    if (effectiveEntityType === "runway") return t("coordinator.creation.namePlaceholderRunway");
    if (effectiveEntityType === "taxiway") return t("coordinator.creation.namePlaceholderTaxiway");
    if (isSafetyZone) return t("coordinator.creation.namePlaceholderZone");
    if (effectiveEntityType === "obstacle") return t("coordinator.creation.namePlaceholderObstacle");
    if (effectiveEntityType === "agl") return t("coordinator.creation.namePlaceholderAgl");
    if (effectiveEntityType === "lha") return t("coordinator.creation.namePlaceholderLha");
    return "";
  }

  const safetyZoneTypeLabel = isSafetyZone
    ? (SAFETY_ZONE_TYPE_MAP[effectiveEntityType] ?? effectiveEntityType)
    : "";

  const hasValidCoords = !isNaN(parseFloat(manualLat)) && !isNaN(parseFloat(manualLon));
  const canSubmit = effectiveEntityType && name.trim()
    && (effectiveEntityType !== "lha" || lhaAglId)
    && (effectiveEntityType !== "agl" || surfaceId)
    && ((effectiveEntityType !== "agl" && effectiveEntityType !== "lha") || hasValidCoords)
    && !papiSlotsExhausted;

  return {
    category,
    handleCategoryChange,
    entityType,
    setEntityType,
    obstacleType,
    setObstacleType,
    effectiveEntityType,
    name,
    setName,
    namePlaceholder,
    heading,
    setHeading,
    length,
    setLength,
    width,
    setWidth,
    touchpointLat,
    setTouchpointLat,
    touchpointLon,
    setTouchpointLon,
    touchpointAlt,
    setTouchpointAlt,
    altFloor,
    setAltFloor,
    altCeiling,
    setAltCeiling,
    isActive,
    setIsActive,
    obstacleHeight,
    setObstacleHeight,
    bufferDistance,
    setBufferDistance,
    surfaceId,
    setSurfaceId,
    aglType,
    setAglType,
    aglSide,
    setAglSide,
    glideSlopeAngle,
    setGlideSlopeAngle,
    glideSlopeAngleTolerance,
    setGlideSlopeAngleTolerance,
    ilsHarmonizationTolerance,
    setIlsHarmonizationTolerance,
    distFromThreshold,
    setDistFromThreshold,
    handleDistFromThresholdChange,
    thresholdLat,
    setThresholdLat,
    thresholdLon,
    setThresholdLon,
    thresholdAlt,
    setThresholdAlt,
    endLat,
    setEndLat,
    endLon,
    setEndLon,
    endAlt,
    setEndAlt,
    swapThresholdEnd,
    resolvedThresholdEnd,
    manualLat,
    setManualLat,
    manualLon,
    setManualLon,
    lhaAglId,
    setLhaAglId,
    lhaSettingAngle,
    setLhaSettingAngle,
    lhaLampType,
    setLhaLampType,
    lhaTolerance,
    setLhaTolerance,
    lhaLensMsl,
    setLhaLensMsl,
    lhaLensAgl,
    setLhaLensAgl,
    isPapiAgl,
    allAgls,
    nextDesignator,
    papiSlotsExhausted,
    categoryOptions,
    needsSubtype,
    isSafetyZone,
    isAirportBoundary,
    safetyZoneTypeLabel,
    prefilledBoundary,
    obstacleHasSinglePoint,
    manualAlt,
    altLoading,
    altFallback,
    handleAltChange,
    error,
    submitting,
    canSubmit,
    handleSubmit,
  };
}
