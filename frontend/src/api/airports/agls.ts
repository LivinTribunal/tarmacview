import type { ListMeta, DeleteResponse } from "@/types/common";
import type { AGLResponse, AGLCreate, AGLUpdate } from "@/types/airport";
import client from "../client";

// agls (nested under surfaces)

export async function listAGLs(
  airportId: string,
  surfaceId: string,
): Promise<{ data: AGLResponse[]; meta: ListMeta }> {
  const res = await client.get(
    `/airports/${airportId}/surfaces/${surfaceId}/agls`,
  );
  return res.data;
}

export async function createAGL(
  airportId: string,
  surfaceId: string,
  data: AGLCreate,
): Promise<AGLResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${surfaceId}/agls`,
    data,
  );
  return res.data;
}

export async function updateAGL(
  airportId: string,
  surfaceId: string,
  id: string,
  data: AGLUpdate,
): Promise<AGLResponse> {
  const res = await client.put(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${id}`,
    data,
  );
  return res.data;
}

export async function deleteAGL(
  airportId: string,
  surfaceId: string,
  id: string,
): Promise<DeleteResponse> {
  const res = await client.delete(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${id}`,
  );
  return res.data;
}
