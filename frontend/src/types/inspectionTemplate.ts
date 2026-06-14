import type { InspectionMethod } from "./enums";
import type { BaseInspectionConfigFields } from "./mission";

export interface InspectionConfigResponse extends BaseInspectionConfigFields {
  id: string;
}

export interface InspectionTemplateResponse {
  id: string;
  name: string;
  description: string | null;
  angular_tolerances: Record<string, number> | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  default_config: InspectionConfigResponse | null;
  target_agl_ids: string[];
  methods: InspectionMethod[];
  mission_count: number;
}

export interface InspectionTemplateCreate {
  name: string;
  description?: string | null;
  angular_tolerances?: Record<string, number> | null;
  target_agl_ids?: string[];
  methods?: InspectionMethod[];
  default_config?: Omit<InspectionConfigResponse, "id"> | null;
}

export interface InspectionTemplateUpdate {
  name?: string;
  description?: string | null;
  angular_tolerances?: Record<string, number> | null;
  target_agl_ids?: string[];
  methods?: InspectionMethod[];
  default_config?: Omit<InspectionConfigResponse, "id"> | null;
}
