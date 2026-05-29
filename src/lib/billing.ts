import { supabase } from "./supabase";

export type BillingStatus = {
  user_id: string | null;
  email: string | null;
  tier: string;
  subscription_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  max_profiles_per_platform: number;
};

export type BillingResponse = {
  status: BillingStatus;
  available_tiers: string[];
};

const CACHE_KEY = "mf-billing-v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: BillingResponse;
  cachedAt: number;
};

export const FREE_FALLBACK: BillingResponse = {
  status: {
    user_id: null,
    email: null,
    tier: "free",
    subscription_status: "none",
    current_period_end: null,
    cancel_at_period_end: false,
    max_profiles_per_platform: 10,
  },
  available_tiers: [],
};

export function loadCachedBilling(): BillingResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry?.cachedAt || Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function saveBillingCache(data: BillingResponse): void {
  try {
    const entry: CacheEntry = { data, cachedAt: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {}
}

export function clearBillingCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

export async function fetchBillingFromSupabase(): Promise<BillingResponse> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const user = userData.user;
  if (!user) {
    throw new Error("No authenticated user");
  }

  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select(
      "tier, max_profiles_per_platform, subscription_status, current_period_end, cancel_at_period_end"
    )
    .eq("user_id", user.id)
    .single();

  if (profileErr) throw profileErr;

  return {
    status: {
      user_id: user.id,
      email: user.email ?? null,
      tier: profile?.tier ?? "free",
      subscription_status: profile?.subscription_status ?? "none",
      current_period_end: profile?.current_period_end ?? null,
      cancel_at_period_end: profile?.cancel_at_period_end ?? false,
      max_profiles_per_platform: profile?.max_profiles_per_platform ?? 10,
    },
    available_tiers: [],
  };
}
