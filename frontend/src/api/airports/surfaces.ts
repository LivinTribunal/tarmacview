import type { ListMeta, DeleteResponse } from "@/types/common";
import type {
  SurfaceCoupleRequest,
  SurfaceCreateReverseRequest,
  SurfaceResponse,
  SurfaceCreate,
  SurfaceUpdate,
  SurfaceRecalculateResponse,
} from "@/types/airport";
import client from "../client";

export async function listSurfaces(
  airportId: string,
): Promise<{ data: SurfaceResponse[]; meta: ListMeta }> {
  const res = await client.get(`/airports/${airportId}/surfaces`);
  return res.data;
}

export async function createSurface(
  airportId: string,
  data: SurfaceCreate,
): Promise<SurfaceResponse> {
  const res = await client.post(`/airports/${airportId}/surfaces`, data);
  return res.data;
}

export async function updateSurface(
  airportId: string,
  id: string,
  data: SurfaceUpdate,
): Promise<SurfaceResponse> {
  const res = await client.put(`/airports/${airportId}/surfaces/${id}`, data);
  return res.data;
}

export async function deleteSurface(
  airportId: string,
  id: string,
): Promise<DeleteResponse> {
  const res = await client.delete(`/airports/${airportId}/surfaces/${id}`);
  return res.data;
}

export async function recalculateSurface(
  airportId: string,
  id: string,
): Promise<SurfaceRecalculateResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${id}/recalculate`,
  );
  return res.data;
}

export async function createReverseSurface(
  airportId: string,
  id: string,
  data: SurfaceCreateReverseRequest = {},
): Promise<SurfaceResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${id}/create-reverse`,
    data,
  );
  return res.data;
}

export async function coupleSurface(
  airportId: string,
  id: string,
  data: SurfaceCoupleRequest,
): Promise<SurfaceResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${id}/couple`,
    data,
  );
  return res.data;
}

export async function decoupleSurface(
  airportId: string,
  id: string,
): Promise<SurfaceResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${id}/decouple`,
  );
  return res.data;
}
