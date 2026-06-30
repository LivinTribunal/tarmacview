import type { PointZ } from "@/types/common";

// matches backend/app/schemas/field_link.py + drone_media.py

export type MediaFileStatus = "RECEIVED" | "MATCHED" | "UNASSIGNED" | "INGESTED";

export type MediaOrigin = "HUB" | "MANUAL";

export interface DroneMediaFileResponse {
  id: string;
  object_key: string;
  fingerprint: string | null;
  captured_at: string | null;
  capture_position: PointZ | null;
  device_sn: string | null;
  mission_id: string | null;
  inspection_id: string | null;
  order_index: number | null;
  origin: MediaOrigin;
  filename: string | null;
  size_bytes: number | null;
  status: MediaFileStatus;
  received_at: string;
  updated_at: string;
}

export interface MissionMediaGroup {
  mission_id: string;
  mission_name: string;
  files: DroneMediaFileResponse[];
}

export interface DroneMediaListResponse {
  missions: MissionMediaGroup[];
  unassigned: DroneMediaFileResponse[];
}

export interface InspectionMediaGroup {
  inspection_id: string;
  method: string;
  sequence_order: number;
  files: DroneMediaFileResponse[];
}

export interface MissionInspectionMediaResponse {
  mission_id: string;
  mission_name: string;
  inspections: InspectionMediaGroup[];
  unassigned: DroneMediaFileResponse[];
}

export interface UploadUrlResponse {
  object_key: string;
  upload_url: string;
}
