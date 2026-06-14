import type {
  ConfirmIngestResponse,
  DroneMediaFileResponse,
  DroneMediaListResponse,
} from "@/types/droneMedia";
import client from "./client";

export async function listDroneMedia(): Promise<DroneMediaListResponse> {
  const res = await client.get("/drone-media");
  return res.data;
}

export async function assignDroneMedia(
  mediaId: string,
  missionId: string | null,
): Promise<DroneMediaFileResponse> {
  const res = await client.post(`/drone-media/${mediaId}/assign`, {
    mission_id: missionId,
  });
  return res.data;
}

export async function confirmDroneMediaIngest(
  missionId: string,
): Promise<ConfirmIngestResponse> {
  const res = await client.post("/drone-media/confirm-ingest", {
    mission_id: missionId,
  });
  return res.data;
}
