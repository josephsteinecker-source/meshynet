// ============================================================
// Device registration + status check (talks to Rust commands)
// ============================================================
// Backend revokes oldest devices over the tier limit automatically.
// register → on login; checkStatus → periodically (before billing).
// ============================================================

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

import { invoke } from "@tauri-apps/api/core";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";

export type DeviceRegisterResult =
  | { ok: true; tier: string; max_devices: number; revoked_count: number }
  | { ok: false; error: string };

export type DeviceStatus = {
  active: boolean;
  reason?: string; // "revoked" | "unauthenticated" | "not_registered" | ...
};

export async function registerDevice(jwt: string): Promise<DeviceRegisterResult> {
  return invoke<DeviceRegisterResult>("mf_register_device", {
    jwt,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
}

export async function checkDeviceStatus(jwt: string): Promise<DeviceStatus> {
  return invoke<DeviceStatus>("mf_check_device_status", {
    jwt,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
}
