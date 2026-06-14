import type { ListMeta, DeleteResponse } from "@/types/common";
import type {
  SafetyZoneResponse,
  SafetyZoneCreate,
  SafetyZoneUpdate,
} from "@/types/airport";
import client from "../client";

export async function listSafetyZones(
  airportId: string,
): Promise<{ data: SafetyZoneResponse[]; meta: ListMeta }> {
  const res = await client.get(`/airports/${airportId}/safety-zones`);
  return res.data;
}

export async function createSafetyZone(
  airportId: string,
  data: SafetyZoneCreate,
): Promise<SafetyZoneResponse> {
  const res = await client.post(`/airports/${airportId}/safety-zones`, data);
  return res.data;
}

export async function updateSafetyZone(
  airportId: string,
  id: string,
  data: SafetyZoneUpdate,
): Promise<SafetyZoneResponse> {
  const res = await client.put(
    `/airports/${airportId}/safety-zones/${id}`,
    data,
  );
  return res.data;
}

export async function deleteSafetyZone(
  airportId: string,
  id: string,
): Promise<DeleteResponse> {
  const res = await client.delete(`/airports/${airportId}/safety-zones/${id}`);
  return res.data;
}
