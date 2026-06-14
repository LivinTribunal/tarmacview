import { useTranslation } from "react-i18next";
import { formatNumber } from "@/utils/format";
import type { MapFeatureWaypoint } from "@/types/map";
import { CoordRows, DeleteButton, EditableCoordRows, InfoRow } from "./rows";

export default function WaypointInfoPanel({
  waypoint,
  editable,
  onCoordinateChange,
  onDeleteTakeoffLanding,
}: {
  waypoint: MapFeatureWaypoint["data"];
  editable: boolean;
  onCoordinateChange?: (waypointId: string, lat: number, lon: number, alt: number) => void;
  onDeleteTakeoffLanding?: (waypointType: string) => void;
}) {
  /** info rows for a waypoint, with stacked and single variants. */
  const { t } = useTranslation();
  const w = waypoint;
  const canDelete = w.waypoint_type === "TAKEOFF" || w.waypoint_type === "LANDING";

  // bookend MEASUREMENTs (#754) absorb the recording start/stop hover and
  // surface here with waypoint_type=MEASUREMENT. without the suffix the row
  // reads as a plain measurement, hiding why the dwell row appears.
  const isRecordingBookend =
    w.waypoint_type === "MEASUREMENT" &&
    (w.camera_action === "RECORDING_START" || w.camera_action === "RECORDING_STOP");
  const typeLabel = isRecordingBookend
    ? `${t("map.waypointTypes.MEASUREMENT", { defaultValue: "Measurement" })} - ${t(
        `map.cameraActionLabel.${w.camera_action}`,
        { defaultValue: w.camera_action },
      )}`
    : w.waypoint_type.replace(/_/g, " ");

  if (w.stack_count > 1) {
    // stacked column - a vertical profile collapses N waypoints into one panel.
    // type/camera_action/hover_duration belong to a single waypoint, not a
    // range, so they're omitted; altitude shows as a range inside the coords
    // block (no separate row) and gimbal pitch widens to min - max degrees.
    const altRange =
      w.alt_min != null && w.alt_max != null
        ? { min: w.alt_min, max: w.alt_max }
        : null;
    const aglRange =
      w.agl_min != null && w.agl_max != null
        ? { min: w.agl_min, max: w.agl_max }
        : null;
    const gimbalRange =
      w.gimbal_pitch_min != null && w.gimbal_pitch_max != null
        ? { min: w.gimbal_pitch_min, max: w.gimbal_pitch_max }
        : null;
    return (
      <>
        <InfoRow
          label={t("dashboard.waypoints")}
          value={w.seq_min != null && w.seq_max != null ? `${w.seq_min}-${w.seq_max} (${w.stack_count})` : String(w.stack_count)}
        />
        <CoordRows
          position={w.position}
          label={t("dashboard.poiCoordinates")}
          agl={w.agl}
          altRange={altRange}
          aglRange={aglRange}
        />
        {w.heading != null && (
          <InfoRow label={t("mission.config.heading")} value={`${formatNumber(w.heading, 1)}°`} />
        )}
        {w.speed != null && (
          <InfoRow label={t("mission.config.speed")} value={`${formatNumber(w.speed, 1)} ${t("common.units.ms")}`} />
        )}
        {gimbalRange ? (
          <InfoRow
            label={t("mission.config.gimbalPitch")}
            value={`${formatNumber(gimbalRange.min, 1)}° → ${formatNumber(gimbalRange.max, 1)}°`}
          />
        ) : (
          w.gimbal_pitch != null && (
            <InfoRow
              label={t("mission.config.gimbalPitch")}
              value={`${formatNumber(w.gimbal_pitch, 1)}°`}
            />
          )
        )}
        {w.camera_target && (
          <CoordRows position={w.camera_target} label={t("map.cameraTarget")} agl={w.camera_target_agl} />
        )}
      </>
    );
  }

  return (
    <>
      <InfoRow label={t("mission.config.type")} value={typeLabel} />
      <InfoRow label={t("mission.config.sequence")} value={String(w.sequence_order)} />
      {editable && onCoordinateChange ? (
        <EditableCoordRows
          position={w.position}
          label={t("dashboard.poiCoordinates")}
          onSave={(lat, lon, alt) => onCoordinateChange(w.id, lat, lon, alt)}
          agl={w.agl}
        />
      ) : (
        <CoordRows position={w.position} label={t("dashboard.poiCoordinates")} agl={w.agl} />
      )}
      {w.heading != null && (
        <InfoRow label={t("mission.config.heading")} value={`${formatNumber(w.heading, 1)}°`} />
      )}
      {w.speed != null && (
        <InfoRow label={t("mission.config.speed")} value={`${formatNumber(w.speed, 1)} ${t("common.units.ms")}`} />
      )}
      <InfoRow
        label={t("mission.config.cameraAction")}
        value={w.camera_action
          ? t(`map.cameraActionLabel.${w.camera_action}`, { defaultValue: w.camera_action })
          : "—"}
      />
      {w.hover_duration != null && (
        <InfoRow
          label={t("map.dwell")}
          value={`${formatNumber(w.hover_duration, 0)} ${t("common.units.s")}`}
        />
      )}
      {w.gimbal_pitch != null && (
        <InfoRow label={t("mission.config.gimbalPitch")} value={`${formatNumber(w.gimbal_pitch, 1)}°`} />
      )}
      {w.camera_target && (
        <CoordRows position={w.camera_target} label={t("map.cameraTarget")} agl={w.camera_target_agl} />
      )}
      {editable && canDelete && onDeleteTakeoffLanding && (
        <DeleteButton
          waypointType={w.waypoint_type}
          onDelete={() => onDeleteTakeoffLanding(w.waypoint_type)}
        />
      )}
    </>
  );
}
