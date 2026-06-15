import type {
  LightBox,
  Measurement,
  MeasurementPreview,
  MeasurementResults,
  MeasurementStatusResponse,
} from "@/types/measurement";
import client from "./client";
import { parseContentDispositionFilename } from "./missions";

/** start a measurement run for an inspection - server reads the inspection's uploaded media. */
export async function createMeasurement(
  inspectionId: string,
): Promise<Measurement> {
  const res = await client.post(`/inspections/${inspectionId}/measurement`);
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
