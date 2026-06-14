import type { PhotoMetadataResponse } from "@/types/airport";
import client from "../client";

export async function extractPhotoMetadata(
  airportId: string,
  files: File[],
): Promise<PhotoMetadataResponse> {
  /** upload 1..N photos and get back per-image extracted position metadata. */
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await client.post(
    `/airports/${airportId}/extract-photo-metadata`,
    formData,
  );
  return res.data;
}
