import type { AuthUser } from "@/types/auth";
import client from "./client";

export interface UserUpdatePayload {
  name?: string;
  password?: string;
  current_password?: string;
}

export async function updateMe(payload: UserUpdatePayload): Promise<AuthUser> {
  const res = await client.put("/auth/me", payload);
  return res.data;
}
