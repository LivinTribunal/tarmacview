import type { ListMeta, DeleteResponse } from "@/types/common";
import type {
  MissionResponse,
  MissionDetailResponse,
  MissionCreate,
  MissionUpdate,
  InspectionResponse,
  InspectionCreate,
  InspectionUpdate,
  ReorderRequest,
  ComputationStatusResponse,
  DjiHeadingMode,
} from "@/types/mission";
import type { MissionStatus } from "@/types/enums";
import type {
  FlightPlanResponse,
  GenerateTrajectoryResponse,
  WaypointPositionUpdate,
} from "@/types/flightPlan";
import type { AltitudeClamp, ExportClampWarning } from "@/types/export";
import type { WaylineDispatchResponse } from "@/types/fieldLink";
import client, { isAxiosError } from "./client";

export async function listMissions(params?: {
  limit?: number;
  offset?: number;
  airport_id?: string;
  drone_profile_id?: string;
}): Promise<{ data: MissionResponse[]; meta: ListMeta }> {
  const res = await client.get("/missions", { params });
  return res.data;
}

export async function getMission(id: string): Promise<MissionDetailResponse> {
  const res = await client.get(`/missions/${id}`);
  return res.data;
}

export async function createMission(
  data: MissionCreate,
): Promise<MissionResponse> {
  const res = await client.post("/missions", data);
  return res.data;
}

export async function updateMission(
  id: string,
  data: MissionUpdate,
): Promise<MissionResponse> {
  const res = await client.put(`/missions/${id}`, data);
  return res.data;
}

export async function deleteMission(id: string): Promise<DeleteResponse> {
  const res = await client.delete(`/missions/${id}`);
  return res.data;
}

export async function duplicateMission(
  id: string,
): Promise<MissionResponse> {
  const res = await client.post(`/missions/${id}/duplicate`);
  return res.data;
}

// status transitions

export async function validateMission(
  id: string,
): Promise<MissionResponse> {
  const res = await client.post(`/missions/${id}/validate`);
  return res.data;
}

export type ExportMissionResult =
  | { kind: "file"; blob: Blob; filename: string | null }
  | ExportClampWarning;

export async function exportMissionFiles(
  id: string,
  formats: string[],
  options: {
    include_geozones?: boolean;
    include_runway_buffers?: boolean;
    dji_heading_mode_override?: DjiHeadingMode | null;
    acknowledge_altitude_clamps?: boolean;
  } = {},
): Promise<ExportMissionResult> {
  try {
    const res = await client.post(
      `/missions/${id}/export`,
      {
        formats,
        include_geozones: options.include_geozones ?? false,
        include_runway_buffers: options.include_runway_buffers ?? false,
        dji_heading_mode_override: options.dji_heading_mode_override ?? null,
        acknowledge_altitude_clamps: options.acknowledge_altitude_clamps ?? false,
      },
      { responseType: "blob" },
    );
    return {
      kind: "file",
      blob: res.data,
      filename: parseContentDispositionFilename(res.headers),
    };
  } catch (err) {
    // 409 with an altitude-clamps payload means "we generated the file but the
    // dji altitude clamps need the operator's acknowledgment before we ship
    // it." parse the blob body (the route uses responseType=blob, so the
    // error response also comes back as a blob) and surface the clamps.
    if (isAxiosError(err) && err.response?.status === 409) {
      const clamps = await readClampWarningFromError(err.response.data);
      if (clamps) return { kind: "clamp_warning", clamps };
    }
    throw err;
  }
}

export type DispatchMissionResult =
  | { kind: "dispatched"; dispatch: WaylineDispatchResponse }
  | ExportClampWarning;

export async function dispatchMission(
  id: string,
  options: { acknowledge_altitude_clamps?: boolean } = {},
): Promise<DispatchMissionResult> {
  try {
    const res = await client.post(`/missions/${id}/dispatch`, {
      acknowledge_altitude_clamps: options.acknowledge_altitude_clamps ?? false,
    });
    return { kind: "dispatched", dispatch: res.data };
  } catch (err) {
    // same 409 contract as export - dispatch builds the same KMZ, so dji
    // altitude clamps need the operator's acknowledgment before it ships.
    if (isAxiosError(err) && err.response?.status === 409) {
      const clamps = await readClampWarningFromError(err.response.data);
      if (clamps) return { kind: "clamp_warning", clamps };
    }
    throw err;
  }
}

async function readClampWarningFromError(
  body: unknown,
): Promise<AltitudeClamp[] | null> {
  // axios returns a Blob when responseType: "blob" - parse it as JSON.
  // any other shape (already-parsed dict, string) is handled best-effort.
  let parsed: unknown = body;
  if (body instanceof Blob) {
    try {
      const text = await body.text();
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  } else if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const detail = (parsed as { detail?: unknown })?.detail;
  if (detail && typeof detail === "object" && "altitude_clamps" in detail) {
    const clamps = (detail as { altitude_clamps: unknown }).altitude_clamps;
    if (Array.isArray(clamps)) return clamps as AltitudeClamp[];
  }
  return null;
}

/** extract filename from a Content-Disposition response header.
 * prefers the rfc 5987 filename* (utf-8) variant when present.
 */
function parseContentDispositionFilename(
  headers: unknown,
): string | null {
  const raw =
    (headers as { "content-disposition"?: string })?.["content-disposition"];
  if (!raw) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(raw);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(raw);
  return plain?.[1] ?? null;
}

export async function downloadMissionReport(
  id: string,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await client.get(`/missions/${id}/mission-report`, {
    responseType: "blob",
  });
  return { blob: res.data, filename: parseContentDispositionFilename(res.headers) };
}

export async function completeMission(
  id: string,
): Promise<MissionResponse> {
  const res = await client.post(`/missions/${id}/complete`);
  return res.data;
}

export async function cancelMission(id: string): Promise<MissionResponse> {
  const res = await client.post(`/missions/${id}/cancel`);
  return res.data;
}

// inspections

export async function addInspection(
  missionId: string,
  data: InspectionCreate,
): Promise<InspectionResponse> {
  const res = await client.post(`/missions/${missionId}/inspections`, data);
  return res.data;
}

export async function updateInspection(
  missionId: string,
  inspectionId: string,
  data: InspectionUpdate,
): Promise<InspectionResponse> {
  const res = await client.put(
    `/missions/${missionId}/inspections/${inspectionId}`,
    data,
  );
  return res.data;
}

export async function removeInspection(
  missionId: string,
  inspectionId: string,
): Promise<DeleteResponse> {
  const res = await client.delete(
    `/missions/${missionId}/inspections/${inspectionId}`,
  );
  return res.data;
}

export async function reorderInspections(
  missionId: string,
  data: ReorderRequest,
): Promise<{ reordered: boolean }> {
  const res = await client.put(
    `/missions/${missionId}/inspections/reorder`,
    data,
  );
  return res.data;
}

// trajectory and flight plan

export async function generateTrajectory(
  missionId: string,
  signal?: AbortSignal,
): Promise<GenerateTrajectoryResponse> {
  const res = await client.post(`/missions/${missionId}/generate-trajectory`, undefined, {
    signal,
  });
  return res.data;
}

export async function getComputationStatus(
  missionId: string,
): Promise<ComputationStatusResponse> {
  const res = await client.get(`/missions/${missionId}/computation-status`);
  return res.data;
}

export async function getFlightPlan(
  missionId: string,
): Promise<FlightPlanResponse> {
  const res = await client.get(`/missions/${missionId}/flight-plan`);
  return res.data;
}

/** re-run safety validation against the persisted plan - distinct from
 * generateTrajectory, which recomputes waypoints; this leaves them byte-identical.
 */
export async function revalidateFlightPlan(
  missionId: string,
): Promise<FlightPlanResponse> {
  const res = await client.post(`/missions/${missionId}/revalidate`);
  return res.data;
}

export async function generateAndFetchTrajectory(
  missionId: string,
): Promise<{ flightPlan: FlightPlanResponse; missionStatus: MissionStatus }> {
  const result = await generateTrajectory(missionId);
  return { flightPlan: result.flight_plan, missionStatus: result.mission_status };
}

export async function batchUpdateWaypoints(
  missionId: string,
  updates: WaypointPositionUpdate[],
): Promise<FlightPlanResponse> {
  const res = await client.put(
    `/missions/${missionId}/flight-plan/waypoints`,
    { updates },
  );
  return res.data;
}

export async function insertTransitWaypoint(
  missionId: string,
  position: { type: "Point"; coordinates: [number, number, number] },
  afterSequence: number,
): Promise<FlightPlanResponse> {
  const res = await client.post(
    `/missions/${missionId}/flight-plan/waypoints/transit`,
    { position, after_sequence: afterSequence },
  );
  return res.data;
}

export async function deleteTransitWaypoint(
  missionId: string,
  waypointId: string,
): Promise<FlightPlanResponse> {
  const res = await client.delete(
    `/missions/${missionId}/flight-plan/waypoints/${waypointId}`,
  );
  return res.data;
}
