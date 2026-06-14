import type { MeasurementResults } from "@/types/measurement";
import client from "./client";
import { parseContentDispositionFilename } from "./missions";

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
