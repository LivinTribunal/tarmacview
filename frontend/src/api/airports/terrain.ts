import type { DeleteResponse } from "@/types/common";
import type {
  TerrainUploadResponse,
  TerrainDownloadResponse,
  ElevationAtPointResponse,
} from "@/types/airport";
import client from "../client";

export async function uploadTerrainDEM(
  airportId: string,
  file: File,
  options?: { rewriteExisting?: boolean },
): Promise<TerrainUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await client.post(
    `/airports/${airportId}/terrain-dem`,
    formData,
    { params: { rewrite_existing: options?.rewriteExisting ?? true } },
  );
  return res.data;
}

export async function deleteTerrainDEM(
  airportId: string,
  options?: { rewriteExisting?: boolean },
): Promise<DeleteResponse> {
  const res = await client.delete(`/airports/${airportId}/terrain-dem`, {
    params: { rewrite_existing: options?.rewriteExisting ?? true },
  });
  return res.data;
}

export async function downloadTerrainData(
  airportId: string,
  options?: { rewriteExisting?: boolean },
): Promise<TerrainDownloadResponse> {
  const res = await client.post(
    `/airports/${airportId}/terrain-download`,
    null,
    { params: { rewrite_existing: options?.rewriteExisting ?? true } },
  );
  return res.data;
}

export async function fetchElevationAt(
  airportId: string,
  lat: number,
  lon: number,
): Promise<ElevationAtPointResponse> {
  const res = await client.get(`/airports/${airportId}/elevation`, {
    params: { lat, lon },
  });
  return res.data;
}
