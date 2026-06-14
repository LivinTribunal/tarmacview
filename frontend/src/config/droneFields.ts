/** drone profile field definitions and form<->payload transforms. */

import type {
  DroneProfileResponse,
  DroneProfileUpdate,
} from "@/types/droneProfile";

export interface FieldDef {
  key: keyof DroneProfileResponse;
  labelKey: string;
  unitKey?: string;
  type: "text" | "number";
}

export const FIELDS: FieldDef[] = [
  { key: "name", labelKey: "name", type: "text" },
  { key: "manufacturer", labelKey: "manufacturer", type: "text" },
  { key: "model", labelKey: "model", type: "text" },
  { key: "max_speed", labelKey: "maxSpeed", unitKey: "ms", type: "number" },
  {
    key: "max_climb_rate",
    labelKey: "maxClimbRate",
    unitKey: "ms",
    type: "number",
  },
  {
    key: "max_altitude",
    labelKey: "maxAltitude",
    unitKey: "m",
    type: "number",
  },
  {
    key: "battery_capacity",
    labelKey: "batteryCapacity",
    unitKey: "mah",
    type: "number",
  },
  {
    key: "endurance_minutes",
    labelKey: "endurance",
    unitKey: "min",
    type: "number",
  },
  {
    key: "camera_resolution",
    labelKey: "cameraResolution",
    type: "text",
  },
  {
    key: "camera_frame_rate",
    labelKey: "cameraFrameRate",
    unitKey: "fps",
    type: "number",
  },
  {
    key: "sensor_fov",
    labelKey: "sensorFov",
    unitKey: "degrees",
    type: "number",
  },
  { key: "weight", labelKey: "weight", unitKey: "kg", type: "number" },
  { key: "max_optical_zoom", labelKey: "maxOpticalZoom", unitKey: "x", type: "number" },
  {
    key: "sensor_base_focal_length",
    labelKey: "sensorBaseFocalLength",
    unitKey: "mm",
    type: "number",
  },
  {
    key: "default_optical_zoom",
    labelKey: "defaultOpticalZoom",
    unitKey: "x",
    type: "number",
  },
];

/** convert drone response to form values. */
export function droneToForm(drone: DroneProfileResponse): Record<string, string> {
  const form: Record<string, string> = {};
  for (const f of FIELDS) {
    const val = drone[f.key];
    form[f.key] = val != null ? String(val) : "";
  }
  return form;
}

/** convert form values to api payload. */
export function formToPayload(form: Record<string, string>): DroneProfileUpdate {
  const payload: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const val = form[f.key];
    if (f.type === "number") {
      payload[f.key] = val ? Number(val) : null;
    } else {
      payload[f.key] = val || null;
    }
  }
  return payload as DroneProfileUpdate;
}
