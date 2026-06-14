import type { InspectionConfigOverride } from "@/types/mission";
import { solveTriangle } from "@/utils/angleLock";

interface UseAngleLockParams {
  // owned by the parent form so it survives inspection/method switches
  angleLocked: boolean;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  // resolved distance_from_lha / camera_gimbal_angle ("" when unset)
  distanceFromLha: number | "";
  cameraGimbalAngle: number | "";
}

interface UseAngleLockResult {
  onDistanceChange: (raw: string) => void;
  onHeightChange: (raw: string) => void;
  onAngleChange: (raw: string) => void;
}

/** hover-point-lock angle lock: editing one of distance/height/angle keeps the triangle consistent. */
export default function useAngleLock({
  angleLocked,
  configOverride,
  onChange,
  distanceFromLha,
  cameraGimbalAngle,
}: UseAngleLockParams): UseAngleLockResult {
  const onDistanceChange = (raw: string) => {
    /** distance edit - recompute height from the locked gimbal angle. */
    const val = raw === "" ? null : parseFloat(raw);
    const next: InspectionConfigOverride = {
      ...configOverride,
      distance_from_lha: val,
    };
    if (angleLocked && val != null && typeof cameraGimbalAngle === "number") {
      const { height } = solveTriangle({
        distance: val,
        angle: cameraGimbalAngle,
      });
      if (height != null) next.height_above_lha = height;
    }
    onChange(next);
  };

  const onHeightChange = (raw: string) => {
    /** height edit - recompute the gimbal angle from the locked distance. */
    const val = raw === "" ? null : parseFloat(raw);
    const next: InspectionConfigOverride = {
      ...configOverride,
      height_above_lha: val,
    };
    if (angleLocked && val != null && typeof distanceFromLha === "number") {
      const { angle } = solveTriangle({
        height: val,
        distance: distanceFromLha,
      });
      if (angle != null) next.camera_gimbal_angle = angle;
    }
    onChange(next);
  };

  const onAngleChange = (raw: string) => {
    /** gimbal-angle edit - recompute height from the locked distance. */
    const val = raw === "" ? null : parseFloat(raw);
    const next: InspectionConfigOverride = {
      ...configOverride,
      camera_gimbal_angle: val,
    };
    if (angleLocked && val != null && typeof distanceFromLha === "number") {
      const { height } = solveTriangle({
        distance: distanceFromLha,
        angle: val,
      });
      if (height != null) next.height_above_lha = height;
    }
    onChange(next);
  };

  return { onDistanceChange, onHeightChange, onAngleChange };
}
