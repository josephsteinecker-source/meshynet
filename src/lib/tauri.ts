import { invoke } from "@tauri-apps/api/core";
import type { Network } from "../types";

export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  try {
    await invoke("plugin:opener|open_url", { url });
    return;
  } catch {}
  try {
    window.open(url, "_blank");
  } catch {}
}

export async function openZenMode(network: Network): Promise<void> {
  try {
    await invoke("otvor_prihlasenie", { network });
  } catch (err) {
    console.error(`[MeshyNet] Failed to open ${network} in zen mode:`, err);
  }
}
