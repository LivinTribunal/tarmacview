import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  InspectionResponse,
  InspectionConfigOverride,
  MissionDetailResponse,
} from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { CameraPresetCreate, CameraPresetResponse } from "@/types/cameraPreset";
import type { AGLResponse } from "@/types/airport";
import { listCameraPresets, createCameraPreset } from "@/api/cameraPresets";
import { VP_DEFAULT_START_DEG, VP_DEFAULT_END_DEG } from "@/constants/mission";
import {
  computeOpticalZoom,
  maxPairwiseDistanceM,
} from "@/utils/cameraAutoCalc";
import { computeMehtHeight } from "@/utils/mehtHeight";
import { methodCaps } from "@/utils/methodAglCompatibility";

// mirrors backend DEFAULT_HORIZONTAL_DISTANCE - when the field is empty the
// trajectory is flown at 400m, so the zoom calc must assume the same.
const DEFAULT_HORIZONTAL_DISTANCE_M = 400;

// vertical-profile scan band stays within the physical PAPI angle envelope -
// the climb is clamped to this range so the preview matches the backend.
const VP_MIN_ANGLE_DEG = 1.0;
const VP_MAX_ANGLE_DEG = 16.5;

// fallback offset added above the max setting angle when angle_offset_above is
// unset - mirrors the backend default for the horizontal-range observation angle.
const DEFAULT_ANGLE_OFFSET_DEG = 0.5;

// standard PAPI glide-slope angle, used when an AGL has no explicit value.
const DEFAULT_GLIDE_SLOPE_DEG = 3.0;

interface UseInspectionConfigParams {
  inspection: InspectionResponse;
  template: InspectionTemplateResponse | null;
  agls: AGLResponse[];
  droneProfile: DroneProfileResponse | null;
  mission: MissionDetailResponse;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  selectedLhaIds: Set<string>;
  directionBearing: number | null;
}

export default function useInspectionConfig({
  inspection,
  template,
  agls,
  droneProfile,
  mission,
  configOverride,
  onChange,
  selectedLhaIds,
  directionBearing,
}: UseInspectionConfigParams) {
  /** value/derived/camera engine for the per-inspection override form. */

  // resolve values: dirty override > saved config > template defaults
  // explicit null in override means "cleared by user" - don't fall through to saved/default.
  const savedCfg = inspection.config;
  const defaultCfg = template?.default_config;

  function resolveNumber(field: keyof InspectionConfigOverride): number | "" {
    if (field in configOverride) {
      const v = configOverride[field];
      return typeof v === "number" ? v : "";
    }
    const saved = savedCfg?.[field as keyof typeof savedCfg];
    if (typeof saved === "number") return saved;
    const def = defaultCfg?.[field as keyof typeof defaultCfg];
    return typeof def === "number" ? def : "";
  }

  const altitudeOffset = resolveNumber("altitude_offset");
  const measurementSpeedOverride = resolveNumber("measurement_speed_override");
  const measurementDensity = resolveNumber("measurement_density");
  const hoverDuration = resolveNumber("hover_duration");
  const bufferDistance = resolveNumber("buffer_distance");
  const horizontalDistance = resolveNumber("horizontal_distance");
  const sweepAngle = resolveNumber("sweep_angle");
  const angleOffsetAbove = resolveNumber("angle_offset_above");
  const angleOffsetBelow = resolveNumber("angle_offset_below");
  const angleStart = resolveNumber("angle_start");
  const angleEnd = resolveNumber("angle_end");
  const angleSource: "PAPI" | "CUSTOM" =
    (configOverride.angle_source !== undefined
      ? configOverride.angle_source
      : savedCfg?.angle_source ?? defaultCfg?.angle_source ?? null) ?? "CUSTOM";
  const captureMode =
    configOverride.capture_mode !== undefined
      ? configOverride.capture_mode
      : savedCfg?.capture_mode ?? defaultCfg?.capture_mode ?? null;
  const recordingSetupDuration = resolveNumber("recording_setup_duration");

  // camera settings - inspection override > saved > template > mission default
  const whiteBalance =
    configOverride.white_balance !== undefined
      ? configOverride.white_balance
      : savedCfg?.white_balance ?? defaultCfg?.white_balance ?? null;
  const isoValue = resolveNumber("iso");
  const shutterSpeed =
    configOverride.shutter_speed !== undefined
      ? configOverride.shutter_speed
      : savedCfg?.shutter_speed ?? defaultCfg?.shutter_speed ?? null;
  const focusMode =
    configOverride.focus_mode !== undefined
      ? configOverride.focus_mode
      : savedCfg?.focus_mode ?? defaultCfg?.focus_mode ?? null;
  const opticalZoom = resolveNumber("optical_zoom");
  // camera_mode override: null = inherit from mission, otherwise AUTO/MANUAL
  const cameraMode: "AUTO" | "MANUAL" | null =
    configOverride.camera_mode !== undefined
      ? configOverride.camera_mode
      : (savedCfg?.camera_mode as "AUTO" | "MANUAL" | null) ?? null;
  const effectiveCameraMode: "AUTO" | "MANUAL" =
    cameraMode ?? (mission.camera_mode ?? "AUTO");

  // horizontal distance from the drone to the lha set - feeds the zoom calc.
  // per method we pull the field that encodes horizontal offset.
  const horizontalDistanceToLha = useMemo(() => {
    const num = (f: keyof InspectionConfigOverride): number | null => {
      const v = resolveNumber(f);
      return typeof v === "number" ? v : null;
    };
    switch (inspection.method) {
      case "HOVER_POINT_LOCK":
        return num("distance_from_lha");
      case "FLY_OVER":
      case "PARALLEL_SIDE_SWEEP":
        return num("lateral_offset") ?? 0;
      case "HORIZONTAL_RANGE":
      case "VERTICAL_PROFILE":
        return num("horizontal_distance") ?? DEFAULT_HORIZONTAL_DISTANCE_M;
      default:
        return null;
    }
  }, [configOverride, savedCfg, defaultCfg, inspection.method]);

  // physical span of the selected lha set - zoom must fit this in the frame.
  const lhaSpanM = useMemo(() => {
    const relevantLhas = (
      template?.target_agl_ids?.length
        ? agls.filter((a) => template.target_agl_ids!.includes(a.id))
        : agls
    ).flatMap((a) =>
      a.lhas.filter((l) => selectedLhaIds.size === 0 || selectedLhaIds.has(l.id)),
    );
    const positions = relevantLhas
      .map((l) => {
        const c = l.position?.coordinates;
        if (!c) return null;
        return { lat: c[1], lng: c[0], alt: c[2] ?? 0 };
      })
      .filter((p): p is { lat: number; lng: number; alt: number } => p !== null);
    if (positions.length <= 1) return 0;
    return maxPairwiseDistanceM(positions);
  }, [template, agls, selectedLhaIds]);

  const computedOpticalZoom = useMemo(() => {
    return computeOpticalZoom(
      horizontalDistanceToLha,
      lhaSpanM,
      droneProfile?.sensor_fov ?? null,
      droneProfile?.max_optical_zoom ?? null,
    );
  }, [horizontalDistanceToLha, lhaSpanM, droneProfile?.sensor_fov, droneProfile?.max_optical_zoom]);

  // zoom live-binds to the computed value until the user drags the slider.
  const [zoomTouched, setZoomTouched] = useState<boolean>(() =>
    "optical_zoom" in configOverride
      ? configOverride.optical_zoom != null
      : savedCfg?.optical_zoom != null,
  );

  // track the inspection + horizontal distance we last keyed zoomTouched against.
  // when inspection switches, re-seed from saved. when only the distance changes
  // for the same inspection, release the touched flag so the derived zoom runs.
  const zoomKeyRef = useRef<{ id: string; dist: number | null }>({
    id: inspection.id,
    dist: horizontalDistanceToLha,
  });
  useEffect(() => {
    const last = zoomKeyRef.current;
    if (last.id !== inspection.id) {
      zoomKeyRef.current = { id: inspection.id, dist: horizontalDistanceToLha };
      setZoomTouched(
        "optical_zoom" in configOverride
          ? configOverride.optical_zoom != null
          : savedCfg?.optical_zoom != null,
      );
      return;
    }
    if (last.dist !== horizontalDistanceToLha) {
      zoomKeyRef.current = { id: inspection.id, dist: horizontalDistanceToLha };
      setZoomTouched(false);
    }
  }, [inspection.id, horizontalDistanceToLha, configOverride, savedCfg]);

  // auto-propagate computed zoom while untouched
  useEffect(() => {
    if (zoomTouched || computedOpticalZoom == null) return;
    const current = resolveNumber("optical_zoom");
    if (current === computedOpticalZoom) return;
    onChange({ ...configOverride, optical_zoom: computedOpticalZoom });
  }, [computedOpticalZoom, zoomTouched]);

  // method-specific fields
  const heightAboveLights = resolveNumber("height_above_lights");
  const lateralOffset = resolveNumber("lateral_offset");
  const distanceFromLha = resolveNumber("distance_from_lha");
  const heightAboveLha = resolveNumber("height_above_lha");
  const cameraGimbalAngle = resolveNumber("camera_gimbal_angle");
  const descentStartDistance = resolveNumber("descent_start_distance");
  const descentGlideSlopeOverride = resolveNumber("descent_glide_slope_override");
  const glideSlopeAngleTolerance = resolveNumber("glide_slope_angle_tolerance");
  const hoverBearing = resolveNumber("hover_bearing");
  const hoverBearingReference: "RUNWAY" | "COMPASS" =
    ("hover_bearing_reference" in configOverride
      ? configOverride.hover_bearing_reference
      : savedCfg?.hover_bearing_reference ?? defaultCfg?.hover_bearing_reference) ?? "RUNWAY";
  const selectedLhaId =
    configOverride.selected_lha_id !== undefined
      ? configOverride.selected_lha_id
      : savedCfg?.selected_lha_id ?? defaultCfg?.selected_lha_id ?? null;

  // lha setting angle override for horizontal range
  const lhaSettingAngleOverrideId =
    configOverride.lha_setting_angle_override_id !== undefined
      ? configOverride.lha_setting_angle_override_id
      : savedCfg?.lha_setting_angle_override_id ?? defaultCfg?.lha_setting_angle_override_id ?? null;

  // hover-point-lock AGL picker - seeded from the currently selected LHA's parent
  const aglOfSelectedLha = useMemo(() => {
    if (!selectedLhaId) return null;
    return agls.find((a) => a.lhas.some((l) => l.id === selectedLhaId)) ?? null;
  }, [agls, selectedLhaId]);
  const [hoverAglId, setHoverAglId] = useState<string>(aglOfSelectedLha?.id ?? "");
  // keep hoverAglId in sync if the parent changes selected_lha_id externally
  useEffect(() => {
    if (aglOfSelectedLha && aglOfSelectedLha.id !== hoverAglId) {
      setHoverAglId(aglOfSelectedLha.id);
    }
  }, [aglOfSelectedLha, hoverAglId]);
  const hoverAgl = agls.find((a) => a.id === hoverAglId) ?? null;

  // effective capture mode for conditional display
  const effectiveCaptureMode = captureMode ?? "VIDEO_CAPTURE";

  // measurement speed warning - checks max_speed since path_distance is not available here
  const speedWarning = useMemo(() => {
    const speed =
      configOverride.measurement_speed_override ??
      savedCfg?.measurement_speed_override ??
      defaultCfg?.measurement_speed_override;
    if (!speed || !droneProfile) return false;

    if (droneProfile.max_speed && speed > droneProfile.max_speed) {
      return true;
    }
    return false;
  }, [configOverride, savedCfg, defaultCfg, droneProfile]);

  // find target AGLs for this template
  const targetAgls = useMemo(() => {
    if (!template?.target_agl_ids?.length) return agls;
    return agls.filter((a) => template.target_agl_ids.includes(a.id));
  }, [agls, template]);

  // meht height computed from first PAPI AGL's distance + glide slope
  const computedMehtHeight = useMemo(() => {
    if (inspection.method !== "MEHT_CHECK") return null;
    const papiAgl = targetAgls.find((a) => a.agl_type === "PAPI");
    if (!papiAgl) return null;
    const dist = papiAgl.distance_from_threshold;
    if (dist == null) return null;
    const gs = papiAgl.glide_slope_angle ?? DEFAULT_GLIDE_SLOPE_DEG;
    return Math.round(computeMehtHeight(dist, gs) * 100) / 100;
  }, [inspection.method, targetAgls]);

  // papi observation angle derived from max setting angle + offset (or override)
  const { computedObservationAngle, missingSettingAngleUnits } = useMemo(() => {
    if (inspection.method !== "HORIZONTAL_RANGE") {
      return { computedObservationAngle: null, missingSettingAngleUnits: [] as string[] };
    }
    const relevantLhas = targetAgls.flatMap((a) =>
      a.lhas.filter((l) => selectedLhaIds.size === 0 || selectedLhaIds.has(l.id)),
    );
    const missing = relevantLhas
      .filter((l) => l.setting_angle == null)
      .map((l) => l.unit_designator);
    const angles = relevantLhas
      .filter((l) => l.setting_angle != null)
      .map((l) => l.setting_angle as number);
    if (angles.length === 0) {
      return { computedObservationAngle: null, missingSettingAngleUnits: missing };
    }
    const effectiveOffset =
      typeof angleOffsetAbove === "number" ? angleOffsetAbove : DEFAULT_ANGLE_OFFSET_DEG;

    // when override is set, use that specific lha's angle instead of max.
    // search the full template (not just selectedLhaIds-filtered lhas) so the
    // preview matches the backend, which also ignores the lha_ids filter.
    if (lhaSettingAngleOverrideId) {
      const overrideLha = targetAgls
        .flatMap((a) => a.lhas)
        .find((l) => l.id === lhaSettingAngleOverrideId);
      if (overrideLha?.setting_angle != null) {
        return {
          computedObservationAngle: Math.round((overrideLha.setting_angle + effectiveOffset) * 100) / 100,
          missingSettingAngleUnits: missing,
        };
      }
    }

    const maxAngle = Math.max(...angles);
    return {
      computedObservationAngle: Math.round((maxAngle + effectiveOffset) * 100) / 100,
      missingSettingAngleUnits: missing,
    };
  }, [inspection.method, targetAgls, selectedLhaIds, angleOffsetAbove, lhaSettingAngleOverrideId]);

  // PAPI mode for vertical profile needs setting angles on every selected LHA;
  // a missing angle on any selected LHA disables PAPI mode and surfaces a hint.
  const verticalProfilePapiMissing = useMemo(() => {
    if (inspection.method !== "VERTICAL_PROFILE") return [] as string[];
    const relevantLhas = targetAgls.flatMap((a) =>
      a.lhas.filter((l) => selectedLhaIds.size === 0 || selectedLhaIds.has(l.id)),
    );
    return relevantLhas
      .filter((l) => l.setting_angle == null)
      .map((l) => l.unit_designator);
  }, [inspection.method, targetAgls, selectedLhaIds]);

  // VP scan preview - resolves the current angle band the climb will cover.
  const verticalProfilePreview = useMemo(() => {
    if (inspection.method !== "VERTICAL_PROFILE") return null;
    const clamp = (v: number) =>
      Math.min(VP_MAX_ANGLE_DEG, Math.max(VP_MIN_ANGLE_DEG, v));

    if (angleSource === "PAPI") {
      const angles = targetAgls.flatMap((a) =>
        a.lhas.reduce<number[]>((acc, l) => {
          if (
            (selectedLhaIds.size === 0 || selectedLhaIds.has(l.id)) &&
            l.setting_angle != null
          ) {
            acc.push(l.setting_angle);
          }
          return acc;
        }, []),
      );
      if (!angles.length) return null;
      const above = typeof angleOffsetAbove === "number" ? angleOffsetAbove : 0;
      const below = typeof angleOffsetBelow === "number" ? angleOffsetBelow : 0;
      const start = clamp(Math.min(...angles) - below);
      const end = clamp(Math.max(...angles) + above);
      return { start, end };
    }

    const start =
      typeof angleStart === "number" ? clamp(angleStart) : VP_DEFAULT_START_DEG;
    const end = typeof angleEnd === "number" ? clamp(angleEnd) : VP_DEFAULT_END_DEG;
    return { start, end };
  }, [
    inspection.method,
    angleSource,
    targetAgls,
    selectedLhaIds,
    angleOffsetAbove,
    angleOffsetBelow,
    angleStart,
    angleEnd,
  ]);

  function handleNumberChange(
    field: keyof InspectionConfigOverride,
    raw: string,
  ) {
    const val = raw === "" ? null : parseFloat(raw);
    onChange({ ...configOverride, [field]: val });
  }

  // camera preset picker
  const [presets, setPresets] = useState<CameraPresetResponse[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    configOverride.camera_preset_id ?? savedCfg?.camera_preset_id ?? "",
  );
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);

  const fetchPresets = useCallback(() => {
    const params: { drone_profile_id?: string } = {};
    if (mission.drone_profile_id) {
      params.drone_profile_id = mission.drone_profile_id;
    }
    listCameraPresets(params)
      .then((res) => setPresets(res.data))
      .catch(() => setPresets([]));
  }, [mission.drone_profile_id]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  // keep the select bound to whatever preset the override/saved config points at.
  // without this, switching to MANUAL auto-applies the default preset but the
  // dropdown still reads "Apply Preset".
  useEffect(() => {
    const pid = configOverride.camera_preset_id !== undefined
      ? configOverride.camera_preset_id
      : savedCfg?.camera_preset_id ?? null;
    setSelectedPresetId(pid ?? "");
  }, [configOverride.camera_preset_id, savedCfg?.camera_preset_id]);

  function handlePresetSelect(presetId: string) {
    setSelectedPresetId(presetId);
    if (!presetId) return;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    onChange({
      ...configOverride,
      camera_mode: "MANUAL",
      camera_preset_id: preset.id,
      white_balance: preset.white_balance,
      iso: preset.iso,
      shutter_speed: preset.shutter_speed,
      focus_mode: preset.focus_mode,
    });
  }

  function handleCameraModeChange(mode: "INHERIT" | "AUTO" | "MANUAL") {
    if (mode === "INHERIT") {
      onChange({ ...configOverride, camera_mode: null });
      return;
    }
    if (mode === "AUTO") {
      onChange({ ...configOverride, camera_mode: "AUTO" });
      return;
    }
    // MANUAL - fill any empty field with the default preset value. Only
    // values that came from the user or a previous preset count as "set";
    // template defaults and our auto-derived focus/zoom are overwritten.
    const hasExplicit = <K extends keyof InspectionConfigOverride>(
      field: K,
    ): boolean => {
      if (field in configOverride) {
        return (configOverride as Record<string, unknown>)[field] != null;
      }
      return (savedCfg as Record<string, unknown> | null | undefined)?.[field] != null;
    };

    const next: InspectionConfigOverride = { ...configOverride, camera_mode: "MANUAL" };
    const def = presets.find((p) => p.is_default);
    if (def) {
      setSelectedPresetId(def.id);
      next.camera_preset_id = def.id;
      if (!hasExplicit("white_balance")) next.white_balance = def.white_balance;
      if (!hasExplicit("iso")) next.iso = def.iso;
      if (!hasExplicit("shutter_speed")) next.shutter_speed = def.shutter_speed;
      if (!hasExplicit("focus_mode")) next.focus_mode = def.focus_mode;
    }
    // geometry-derived zoom always fills in when user hasn't touched the slider
    if (!zoomTouched && computedOpticalZoom != null) {
      next.optical_zoom = computedOpticalZoom;
    }
    onChange(next);
  }

  function handleSaveAsPreset() {
    if (!presetName.trim()) return;
    setSavingPreset(true);
    createCameraPreset({
      name: presetName.trim(),
      drone_profile_id: mission.drone_profile_id ?? undefined,
      white_balance: whiteBalance as CameraPresetCreate["white_balance"],
      iso: (typeof isoValue === "number" ? isoValue : undefined) as CameraPresetCreate["iso"],
      shutter_speed: shutterSpeed as CameraPresetCreate["shutter_speed"],
      focus_mode: focusMode as CameraPresetCreate["focus_mode"],
    })
      .then(() => {
        setShowSavePreset(false);
        setPresetName("");
        fetchPresets();
      })
      .catch((err) => {
        console.error("save preset failed", err);
      })
      .finally(() => setSavingPreset(false));
  }

  // direction flip - shown for methods where the path has an orientation
  const showDirectionSection = methodCaps(inspection.method).usesDirection;
  // direction value: dirty override > saved. null = inherit from mission.
  const inspectionDirection: "NATURAL" | "REVERSED" | null =
    "direction" in configOverride
      ? (configOverride.direction ?? null)
      : (savedCfg?.direction ?? null);
  const savedDirection: "NATURAL" | "REVERSED" | null = savedCfg?.direction ?? null;
  // dirty when override differs from saved - bearing flips visually until recompute
  const isDirectionDirty =
    "direction" in configOverride && configOverride.direction !== savedDirection;
  // last solver-resolved direction; used as fallback display when direction is null.
  const resolvedDirection: "NATURAL" | "REVERSED" | null =
    savedCfg?.resolved_direction ?? null;
  const effectiveReversed =
    inspectionDirection !== null
      ? inspectionDirection === "REVERSED"
      : resolvedDirection === "REVERSED";
  // directionBearing is the already-compiled heading, so flip when in-flight choice
  // diverges from the compiled direction (saved override or solver-resolved fallback).
  const compiledReversed = resolvedDirection === "REVERSED";
  const bearingFlipped = effectiveReversed !== compiledReversed;
  const displayedBearing =
    directionBearing === null
      ? null
      : bearingFlipped
        ? (directionBearing + 180) % 360
        : directionBearing;

  return {
    altitudeOffset,
    measurementSpeedOverride,
    measurementDensity,
    hoverDuration,
    bufferDistance,
    horizontalDistance,
    sweepAngle,
    angleOffsetAbove,
    angleOffsetBelow,
    angleStart,
    angleEnd,
    angleSource,
    captureMode,
    recordingSetupDuration,
    whiteBalance,
    isoValue,
    shutterSpeed,
    focusMode,
    opticalZoom,
    cameraMode,
    effectiveCameraMode,
    heightAboveLights,
    lateralOffset,
    distanceFromLha,
    heightAboveLha,
    cameraGimbalAngle,
    descentStartDistance,
    descentGlideSlopeOverride,
    glideSlopeAngleTolerance,
    hoverBearing,
    hoverBearingReference,
    selectedLhaId,
    lhaSettingAngleOverrideId,
    effectiveCaptureMode,
    horizontalDistanceToLha,
    lhaSpanM,
    computedOpticalZoom,
    targetAgls,
    computedMehtHeight,
    computedObservationAngle,
    missingSettingAngleUnits,
    verticalProfilePapiMissing,
    verticalProfilePreview,
    aglOfSelectedLha,
    speedWarning,
    hoverAglId,
    setHoverAglId,
    hoverAgl,
    zoomTouched,
    setZoomTouched,
    presets,
    selectedPresetId,
    savingPreset,
    presetName,
    setPresetName,
    showSavePreset,
    setShowSavePreset,
    fetchPresets,
    handlePresetSelect,
    handleCameraModeChange,
    handleSaveAsPreset,
    handleNumberChange,
    showDirectionSection,
    inspectionDirection,
    savedDirection,
    isDirectionDirty,
    resolvedDirection,
    effectiveReversed,
    compiledReversed,
    bearingFlipped,
    displayedBearing,
  };
}
