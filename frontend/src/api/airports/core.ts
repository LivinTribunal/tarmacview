import type { ListMeta, DeleteResponse } from "@/types/common";
import type {
  AirportLookupResponse,
  AirportResponse,
  AirportSummaryResponse,
  AirportDetailResponse,
  AirportCreate,
  AirportUpdate,
  BulkChangeDroneResponse,
} from "@/types/airport";
import client from "../client";

export async function listAirports(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ data: AirportResponse[]; meta: ListMeta }> {
  const res = await client.get("/airports", { params });
  return res.data;
}

export async function listAirportSummaries(): Promise<{
  data: AirportSummaryResponse[];
  meta: ListMeta;
}> {
  const res = await client.get("/airports/summary");
  return res.data;
}

export async function getAirport(id: string): Promise<AirportDetailResponse> {
  const res = await client.get(`/airports/${id}`);
  return res.data;
}

export async function createAirport(
  data: AirportCreate,
): Promise<AirportResponse> {
  const res = await client.post("/airports", data);
  return res.data;
}

export async function lookupAirport(
  icaoCode: string,
  radiusKm?: number,
): Promise<AirportLookupResponse> {
  const res = await client.get(
    `/airports/lookup/${encodeURIComponent(icaoCode)}`,
    { params: radiusKm != null ? { radius_km: radiusKm } : undefined },
  );
  return res.data;
}

export async function updateAirport(
  id: string,
  data: AirportUpdate,
  options?: { rewriteExisting?: boolean },
): Promise<AirportResponse> {
  const res = await client.put(`/airports/${id}`, data, {
    params: { rewrite_existing: options?.rewriteExisting ?? true },
  });
  return res.data;
}

export async function deleteAirport(id: string): Promise<DeleteResponse> {
  const res = await client.delete(`/airports/${id}`);
  return res.data;
}

export async function setDefaultDrone(
  airportId: string,
  droneProfileId: string | null,
): Promise<AirportResponse> {
  const res = await client.put(`/airports/${airportId}/default-drone`, {
    drone_profile_id: droneProfileId,
  });
  return res.data;
}

export async function bulkChangeDrone(
  airportId: string,
  droneProfileId: string,
  options?: {
    fromDroneId?: string;
    scope?: "ALL_DRAFT" | "SELECTED";
    missionIds?: string[];
  },
): Promise<BulkChangeDroneResponse> {
  const res = await client.post(`/airports/${airportId}/bulk-change-drone`, {
    drone_profile_id: droneProfileId,
    from_drone_id: options?.fromDroneId ?? null,
    scope: options?.scope ?? "ALL_DRAFT",
    mission_ids: options?.missionIds ?? [],
  });
  return res.data;
}
