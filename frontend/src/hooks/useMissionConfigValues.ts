import { useState, useEffect, useCallback } from "react";
import type { MissionDetailResponse, MissionUpdate } from "@/types/mission";
import type { FlightPlanScope } from "@/types/enums";
import type { CameraPresetResponse } from "@/types/cameraPreset";
import { listCameraPresets } from "@/api/cameraPresets";

/** resolves mission config fields (values over mission) and owns camera-preset state + handlers. */
export function useMissionConfigValues(
  mission: MissionDetailResponse,
  values: Partial<MissionUpdate>,
  onChange: (update: Partial<MissionUpdate>) => void,
) {
  const droneProfileId =
    values.drone_profile_id !== undefined
      ? values.drone_profile_id
      : mission.drone_profile_id;
  const defaultSpeed =
    values.default_speed !== undefined
      ? values.default_speed
      : mission.default_speed;
  const measurementSpeedOverride =
    values.measurement_speed_override !== undefined
      ? values.measurement_speed_override
      : mission.measurement_speed_override;
  const defaultAltitudeOffset =
    values.default_altitude_offset !== undefined
      ? values.default_altitude_offset
      : mission.default_altitude_offset;
  const takeoff =
    values.takeoff_coordinate !== undefined
      ? values.takeoff_coordinate
      : mission.takeoff_coordinate;
  const landing =
    values.landing_coordinate !== undefined
      ? values.landing_coordinate
      : mission.landing_coordinate;
  const notes =
    values.operator_notes !== undefined
      ? values.operator_notes
      : mission.operator_notes;
  const defaultCaptureMode =
    values.default_capture_mode !== undefined
      ? values.default_capture_mode
      : mission.default_capture_mode;
  const defaultBufferDistance =
    values.default_buffer_distance !== undefined
      ? values.default_buffer_distance
      : mission.default_buffer_distance;
  const defaultWhiteBalance =
    values.default_white_balance !== undefined
      ? values.default_white_balance
      : mission.default_white_balance;
  const defaultIso =
    values.default_iso !== undefined
      ? values.default_iso
      : mission.default_iso;
  const defaultShutterSpeed =
    values.default_shutter_speed !== undefined
      ? values.default_shutter_speed
      : mission.default_shutter_speed;
  const defaultFocusMode =
    values.default_focus_mode !== undefined
      ? values.default_focus_mode
      : mission.default_focus_mode;
  const cameraMode =
    values.camera_mode !== undefined
      ? values.camera_mode
      : (mission.camera_mode ?? "AUTO");
  const transitAgl =
    values.transit_agl !== undefined
      ? values.transit_agl
      : mission.transit_agl;
  const requirePerpendicularCrossing =
    values.require_perpendicular_runway_crossing !== undefined
      ? values.require_perpendicular_runway_crossing
      : mission.require_perpendicular_runway_crossing ?? true;
  const keepInsideAirportBoundary: boolean =
    values.keep_inside_airport_boundary !== undefined
      ? values.keep_inside_airport_boundary
      : mission.keep_inside_airport_boundary ?? true;
  const flightPlanScope: FlightPlanScope =
    values.flight_plan_scope !== undefined
      ? values.flight_plan_scope
      : mission.flight_plan_scope ?? "FULL";
  const missionDirection: "AUTO" | "NATURAL" | "REVERSED" =
    values.direction !== undefined
      ? values.direction
      : mission.direction ?? "AUTO";

  const [presets, setPresets] = useState<CameraPresetResponse[]>([]);
  const [appliedPresetId, setAppliedPresetId] = useState<string>("");

  const fetchPresets = useCallback(() => {
    const params: { drone_profile_id?: string } = {};
    if (droneProfileId) params.drone_profile_id = droneProfileId;
    listCameraPresets(params)
      .then((res) => setPresets(res.data))
      .catch(() => setPresets([]));
  }, [droneProfileId]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  // derive the applied preset from current camera fields so the dropdown
  // reflects a matching preset (e.g. the default loaded on MANUAL switch or
  // after reload) instead of "Apply a preset".
  useEffect(() => {
    if (cameraMode !== "MANUAL" || presets.length === 0) return;
    const match = presets.find(
      (p) =>
        (p.white_balance ?? null) === (defaultWhiteBalance ?? null)
        && (p.iso ?? null) === (defaultIso ?? null)
        && (p.shutter_speed ?? null) === (defaultShutterSpeed ?? null)
        && (p.focus_mode ?? null) === (defaultFocusMode ?? null),
    );
    setAppliedPresetId(match ? match.id : "");
  }, [cameraMode, presets, defaultWhiteBalance, defaultIso, defaultShutterSpeed, defaultFocusMode]);

  function handlePresetApply(presetId: string) {
    /** apply a saved camera preset, switching to MANUAL mode. */
    if (!presetId) {
      setAppliedPresetId("");
      return;
    }
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setAppliedPresetId(preset.id);
    onChange({
      camera_mode: "MANUAL",
      default_white_balance: preset.white_balance ?? null,
      default_iso: preset.iso ?? null,
      default_shutter_speed: preset.shutter_speed ?? null,
      default_focus_mode: preset.focus_mode ?? null,
    });
  }

  function handleCameraModeChange(mode: "AUTO" | "MANUAL") {
    /** switch camera mode, preloading the drone default preset on first MANUAL. */
    if (mode === cameraMode) return;
    if (mode === "AUTO") {
      onChange({ camera_mode: "AUTO" });
      return;
    }
    // MANUAL - if no fields set yet, preload from drone default preset
    const hasAny =
      defaultWhiteBalance || defaultIso || defaultShutterSpeed || defaultFocusMode;
    if (hasAny) {
      onChange({ camera_mode: "MANUAL" });
      return;
    }
    const def = presets.find((p) => p.is_default);
    if (def) {
      setAppliedPresetId(def.id);
      onChange({
        camera_mode: "MANUAL",
        default_white_balance: def.white_balance ?? null,
        default_iso: def.iso ?? null,
        default_shutter_speed: def.shutter_speed ?? null,
        default_focus_mode: def.focus_mode ?? null,
      });
    } else {
      onChange({ camera_mode: "MANUAL" });
    }
  }

  return {
    droneProfileId,
    defaultSpeed,
    measurementSpeedOverride,
    defaultAltitudeOffset,
    takeoff,
    landing,
    notes,
    defaultCaptureMode,
    defaultBufferDistance,
    defaultWhiteBalance,
    defaultIso,
    defaultShutterSpeed,
    defaultFocusMode,
    cameraMode,
    transitAgl,
    requirePerpendicularCrossing,
    keepInsideAirportBoundary,
    flightPlanScope,
    missionDirection,
    presets,
    appliedPresetId,
    handlePresetApply,
    handleCameraModeChange,
  };
}
