import type { AirportSummary } from "@/types/auth";
import type { ListMeta } from "@/types/common";

export interface UserAdminResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  airports: AirportSummary[];
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserInviteRequest {
  email: string;
  name: string;
  role: string;
  airport_ids: string[];
}

export interface UserAdminUpdate {
  name?: string;
  email?: string;
  role?: string;
}

export interface InvitationResponse {
  user: UserAdminResponse;
  invitation_link: string;
}

export interface AirportAssignmentUpdate {
  airport_ids: string[];
}

export interface AirportAdminResponse {
  id: string;
  icao_code: string;
  name: string;
  city: string | null;
  country: string | null;
  user_count: number;
  coordinator_count: number;
  operator_count: number;
  mission_count: number;
  drone_count: number;
  terrain_source: string;
  created_at: string | null;
}

export type ElevationApiProvider = "OPEN_ELEVATION";

export const ELEVATION_API_KEY_MASK = "••••••";

export interface SystemSettingsResponse {
  maintenance_mode: boolean;
  cesium_ion_token: string;
  elevation_api_url: string;
  elevation_api_fallback_enabled: boolean;
  elevation_api_provider: ElevationApiProvider;
  elevation_api_key: string | null;
  backup_enabled: boolean;
  backup_interval_hours: number;
  backup_retention_count: number;
  last_backup_at: string | null;
  last_backup_status: string | null;
}

export interface SystemSettingsUpdate {
  maintenance_mode?: boolean;
  cesium_ion_token?: string;
  elevation_api_url?: string;
  elevation_api_fallback_enabled?: boolean;
  elevation_api_provider?: ElevationApiProvider;
  elevation_api_key?: string | null;
  backup_enabled?: boolean;
  backup_interval_hours?: number;
  backup_retention_count?: number;
}

export interface BackupItem {
  key: string;
  size: number;
  last_modified: string;
}

export interface BackupListResponse {
  backups: BackupItem[];
  last_backup_at: string | null;
  last_backup_status: string | null;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  airport_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
}

export interface AuditLogListResponse {
  data: AuditLogEntry[];
  meta: ListMeta;
}

export interface UserListResponse {
  data: UserAdminResponse[];
  meta: ListMeta;
}
