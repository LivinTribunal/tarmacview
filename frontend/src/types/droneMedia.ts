import type { PointZ } from "@/types/common";

// matches backend/app/schemas/field_link.py + drone_media.py

export type MediaFileStatus = "RECEIVED" | "MATCHED" | "UNASSIGNED" | "INGESTED";

export interface DroneMediaFileResponse {
  id: string;
  object_key: string;
  fingerprint: string;
  captured_at: string | null;
  capture_position: PointZ | null;
  device_sn: string | null;
  mission_id: string | null;
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

export interface ConfirmIngestResponse {
  mission_id: string;
  ingested_count: number;
}
