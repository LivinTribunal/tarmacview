import { useTranslation } from "react-i18next";
import type { DroneProfileResponse } from "@/types/droneProfile";

interface FieldDef {
  key: keyof DroneProfileResponse;
  labelKey: string;
  unitKey?: string;
}

const FIELDS: FieldDef[] = [
  { key: "name", labelKey: "name" },
  { key: "manufacturer", labelKey: "manufacturer" },
  { key: "model", labelKey: "model" },
  { key: "max_speed", labelKey: "maxSpeed", unitKey: "ms" },
  { key: "max_climb_rate", labelKey: "maxClimbRate", unitKey: "ms" },
  { key: "max_altitude", labelKey: "maxAltitude", unitKey: "m" },
  { key: "battery_capacity", labelKey: "batteryCapacity", unitKey: "mah" },
  { key: "endurance_minutes", labelKey: "endurance", unitKey: "min" },
  { key: "camera_resolution", labelKey: "cameraResolution" },
  { key: "camera_frame_rate", labelKey: "cameraFrameRate", unitKey: "fps" },
  { key: "sensor_fov", labelKey: "sensorFov", unitKey: "degrees" },
  { key: "weight", labelKey: "weight", unitKey: "kg" },
];

interface DroneSpecGridProps {
  drone: DroneProfileResponse;
}

/** read-only grid of drone profile specifications. */
export default function DroneSpecGrid({ drone }: DroneSpecGridProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-4">
      {FIELDS.map((field) => {
        const label = t(`coordinator.drones.fields.${field.labelKey}`);
        const unitLabel = field.unitKey
          ? t(`coordinator.drones.units.${field.unitKey}`)
          : "";
        const fieldValue = drone[field.key];
        const displayValue =
          fieldValue != null && fieldValue !== ""
            ? String(fieldValue)
            : "—";

        return (
          <div key={field.key}>
            <span className="block text-xs text-tv-text-secondary mb-1">
              {unitLabel ? `${label} (${unitLabel})` : label}
            </span>
            <span className="block text-sm text-tv-text-primary">
              {displayValue}
            </span>
          </div>
        );
      })}
    </div>
  );
}
