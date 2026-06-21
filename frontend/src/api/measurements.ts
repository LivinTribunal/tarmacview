import type {
  IterationCompare,
  LightBox,
  Measurement,
  MeasurementIteration,
  MeasurementListItem,
  MeasurementPreview,
  MeasurementResults,
  MeasurementStatusResponse,
} from "@/types/measurement";
import client from "./client";
import { parseContentDispositionFilename } from "./missions";

/** rename a run - set or clear its free-text label (null/blank clears it). */
export async function updateMeasurement(
  measurementId: string,
  label: string | null,
): Promise<Measurement> {
  const res = await client.patch(`/measurements/${measurementId}`, { label });
  return res.data;
}

/** delete a run and its object-storage artifacts; resolves on 204. */
export async function deleteMeasurement(measurementId: string): Promise<void> {
  await client.delete(`/measurements/${measurementId}`);
}

/** start a measurement run for an inspection - server reads the inspection's uploaded media. */
export async function createMeasurement(
  inspectionId: string,
): Promise<Measurement> {
  const res = await client.post(`/inspections/${inspectionId}/measurement`);
  return res.data;
}

/** every measurement across an airport's missions/inspections, newest first. */
export async function listAirportMeasurements(
  airportId: string,
): Promise<MeasurementListItem[]> {
  const res = await client.get(`/airports/${airportId}/measurements`);
  return res.data;
}

/** progress poll - status doubles as the phase, error_message set only on ERROR. */
export async function getMeasurementStatus(
  measurementId: string,
): Promise<MeasurementStatusResponse> {
  const res = await client.get(`/measurements/${measurementId}/status`);
  return res.data;
}

/** first-frame image url + detected light boxes for the confirm step. */
export async function getMeasurementPreview(
  measurementId: string,
): Promise<MeasurementPreview> {
  const res = await client.get(`/measurements/${measurementId}/preview`);
  return res.data;
}

/** confirm/adjust the boxes and kick off full processing. */
export async function confirmMeasurementLights(
  measurementId: string,
  boxes: LightBox[],
): Promise<Measurement> {
  const res = await client.post(`/measurements/${measurementId}/confirm-lights`, {
    boxes,
  });
  return res.data;
}

export async function getMeasurementResults(
  measurementId: string,
): Promise<MeasurementResults> {
  const res = await client.get(`/measurements/${measurementId}/data`);
  return res.data;
}

/** re-fly the run's inspection from freshly uploaded media, linked into its group. */
export async function iterateMeasurement(
  measurementId: string,
  mediaObjectKeys: string[],
): Promise<Measurement> {
  const res = await client.post(`/measurements/${measurementId}/iterate`, {
    media_object_keys: mediaObjectKeys,
  });
  return res.data;
}

/** every run in this measurement's iteration group, ordered by iteration_index. */
export async function listMeasurementIterations(
  measurementId: string,
): Promise<MeasurementIteration[]> {
  const res = await client.get(`/measurements/${measurementId}/iterations`);
  return res.data;
}

/** N-way convergence compare across a group; omitting iterations returns every run. */
export async function compareIterations(
  groupId: string,
  iterations?: number[],
): Promise<IterationCompare> {
  const params =
    iterations && iterations.length ? { iterations: iterations.join(",") } : undefined;
  const res = await client.get(`/iteration-groups/${groupId}/compare`, { params });
  return res.data;
}

export async function downloadMeasurementReport(
  measurementId: string,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await client.get(`/measurements/${measurementId}/pdf-report`, {
    responseType: "blob",
  });
  return {
    blob: res.data,
    filename: parseContentDispositionFilename(res.headers),
  };
}
