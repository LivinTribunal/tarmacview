import type { ListMeta, DeleteResponse } from "@/types/common";
import type {
  ObstacleResponse,
  ObstacleCreate,
  ObstacleUpdate,
  ObstacleRecalculateResponse,
} from "@/types/airport";
import client from "../client";

export async function listObstacles(
  airportId: string,
): Promise<{ data: ObstacleResponse[]; meta: ListMeta }> {
  const res = await client.get(`/airports/${airportId}/obstacles`);
  return res.data;
}

export async function createObstacle(
  airportId: string,
  data: ObstacleCreate,
): Promise<ObstacleResponse> {
  const res = await client.post(`/airports/${airportId}/obstacles`, data);
  return res.data;
}

export async function updateObstacle(
  airportId: string,
  id: string,
  data: ObstacleUpdate,
): Promise<ObstacleResponse> {
  const res = await client.put(`/airports/${airportId}/obstacles/${id}`, data);
  return res.data;
}

export async function deleteObstacle(
  airportId: string,
  id: string,
): Promise<DeleteResponse> {
  const res = await client.delete(`/airports/${airportId}/obstacles/${id}`);
  return res.data;
}

export async function recalculateObstacle(
  airportId: string,
  id: string,
): Promise<ObstacleRecalculateResponse> {
  const res = await client.post(
    `/airports/${airportId}/obstacles/${id}/recalculate`,
  );
  return res.data;
}
