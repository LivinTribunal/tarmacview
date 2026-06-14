import type { ListMeta, DeleteResponse } from "@/types/common";
import type {
  LHAResponse,
  LHACreate,
  LHAUpdate,
  LHABulkGenerateRequest,
  LHABulkGenerateResponse,
} from "@/types/airport";
import client from "../client";

// lhas (nested under agls)

export async function listLHAs(
  airportId: string,
  surfaceId: string,
  aglId: string,
): Promise<{ data: LHAResponse[]; meta: ListMeta }> {
  const res = await client.get(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${aglId}/lhas`,
  );
  return res.data;
}

export async function createLHA(
  airportId: string,
  surfaceId: string,
  aglId: string,
  data: LHACreate,
): Promise<LHAResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${aglId}/lhas`,
    data,
  );
  return res.data;
}

export async function updateLHA(
  airportId: string,
  surfaceId: string,
  aglId: string,
  id: string,
  data: LHAUpdate,
): Promise<LHAResponse> {
  const res = await client.put(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${aglId}/lhas/${id}`,
    data,
  );
  return res.data;
}

export async function deleteLHA(
  airportId: string,
  surfaceId: string,
  aglId: string,
  id: string,
): Promise<DeleteResponse> {
  const res = await client.delete(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${aglId}/lhas/${id}`,
  );
  return res.data;
}

export async function bulkCreateLHAs(
  airportId: string,
  surfaceId: string,
  aglId: string,
  data: LHABulkGenerateRequest,
): Promise<LHABulkGenerateResponse> {
  const res = await client.post(
    `/airports/${airportId}/surfaces/${surfaceId}/agls/${aglId}/lhas/bulk`,
    data,
  );
  return res.data;
}
