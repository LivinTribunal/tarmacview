import type { AuthUser } from "@/types/auth";
import client from "./client";

export interface UserUpdatePayload {
  name?: string;
  password?: string;
  current_password?: string;
}

export async function getMe(): Promise<AuthUser> {
  const res = await client.get("/auth/me");
  return res.data;
}

export async function updateMe(payload: UserUpdatePayload): Promise<AuthUser> {
  const res = await client.put("/auth/me", payload);
  return res.data;
}
