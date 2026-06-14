import type {
  ConfirmIngestResponse,
  DroneMediaFileResponse,
  DroneMediaListResponse,
  InspectionMediaGroup,
  MissionInspectionMediaResponse,
  UploadUrlResponse,
} from "@/types/droneMedia";
import client from "./client";

export async function listDroneMedia(): Promise<DroneMediaListResponse> {
  const res = await client.get("/drone-media");
  return res.data;
}

export async function listMissionDroneMedia(
  missionId: string,
): Promise<MissionInspectionMediaResponse> {
  const res = await client.get(`/missions/${missionId}/drone-media`);
  return res.data;
}

export async function requestUploadUrl(
  filename: string,
  contentType: string | null,
): Promise<UploadUrlResponse> {
  const res = await client.post("/drone-media/upload-url", {
    filename,
    content_type: contentType,
  });
  return res.data;
}

/** uploads a file straight to object storage via a presigned PUT (raw fetch, no jwt). */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: file.type ? { "Content-Type": file.type } : undefined,
  });
  if (!res.ok) {
    throw new Error(`upload failed with status ${res.status}`);
  }
}

export async function completeDroneMediaUpload(params: {
  missionId: string;
  inspectionId: string | null;
  objectKey: string;
  filename: string;
  sizeBytes: number;
}): Promise<DroneMediaFileResponse> {
  const res = await client.post("/drone-media/complete-upload", {
    mission_id: params.missionId,
    inspection_id: params.inspectionId,
    object_key: params.objectKey,
    filename: params.filename,
    size_bytes: params.sizeBytes,
  });
  return res.data;
}

export async function moveDroneMedia(
  mediaId: string,
  inspectionId: string | null,
  orderIndex: number | null,
): Promise<DroneMediaFileResponse> {
  const res = await client.put(`/drone-media/${mediaId}/move`, {
    inspection_id: inspectionId,
    order_index: orderIndex,
  });
  return res.data;
}

export async function reorderInspectionMedia(
  inspectionId: string,
  orderedIds: string[],
): Promise<InspectionMediaGroup> {
  const res = await client.put(
    `/drone-media/inspections/${inspectionId}/reorder`,
    { ordered_ids: orderedIds },
  );
  return res.data;
}

export async function deleteDroneMedia(mediaId: string): Promise<void> {
  await client.delete(`/drone-media/${mediaId}`);
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
