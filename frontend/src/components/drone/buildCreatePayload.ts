import type { DroneProfileCreate } from "@/types/droneProfile";

export interface CreateForm {
  name: string;
  max_speed: string;
  max_altitude: string;
  endurance_minutes: string;
  camera_frame_rate: string;
}

/** build the create payload exactly the way DroneListPage did before. */
export function buildCreatePayload(
  form: CreateForm,
  modelId: string | null,
): DroneProfileCreate {
  return {
    name: form.name.trim(),
    max_speed: form.max_speed ? Number(form.max_speed) : undefined,
    max_altitude: form.max_altitude ? Number(form.max_altitude) : undefined,
    endurance_minutes: form.endurance_minutes
      ? Number(form.endurance_minutes)
      : undefined,
    camera_frame_rate: form.camera_frame_rate
      ? Number(form.camera_frame_rate)
      : undefined,
    model_identifier: modelId ?? undefined,
  };
}
