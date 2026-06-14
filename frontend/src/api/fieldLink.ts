import type { FieldLinkStatusResponse } from "@/types/fieldLink";
import client from "./client";

export async function getFieldLinkStatus(): Promise<FieldLinkStatusResponse> {
  const res = await client.get("/field-link/status");
  return res.data;
}
