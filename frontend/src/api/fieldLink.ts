import type {
  FieldLinkStatusResponse,
  FieldLinkWaylineListResponse,
} from "@/types/fieldLink";
import client from "./client";

export async function getFieldLinkStatus(): Promise<FieldLinkStatusResponse> {
  const res = await client.get("/field-link/status");
  return res.data;
}

export async function listWaylines(): Promise<FieldLinkWaylineListResponse> {
  const res = await client.get("/field-link/waylines");
  return res.data;
}

export async function deleteWayline(id: string): Promise<void> {
  await client.delete(`/field-link/waylines/${id}`);
}

// downloads the hub's local CA cert as a blob through the jwt client - the
// endpoint is operator-gated, so a plain <a href> can't carry the bearer.
export async function downloadCaCert(): Promise<{ blob: Blob; filename: string }> {
  const res = await client.get("/field-link/ca-cert", { responseType: "blob" });
  return { blob: res.data, filename: "fieldhub-ca.crt" };
}
