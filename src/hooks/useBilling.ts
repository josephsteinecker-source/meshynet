import { useState, useEffect, useCallback } from "react";
import type { Session } from "../lib/supabase";
import {
  type BillingResponse,
  FREE_FALLBACK,
  loadCachedBilling,
  saveBillingCache,
  clearBillingCache,
  fetchBillingFromSupabase,
} from "../lib/billing";

export function useBilling(session: Session | null, authLoaded: boolean) {
  const [billingStatus, setBillingStatus] = useState<BillingResponse | null>(null);
  const [billingLoaded, setBillingLoaded] = useState(false);

  const performFetch = useCallback(async () => {
    try {
      const fresh = await fetchBillingFromSupabase();
      console.log(
        `[MF] Billing fetched: tier=${fresh.status.tier}, ` +
          `max_profiles_per_platform=${fresh.status.max_profiles_per_platform}`
      );
      setBillingStatus(fresh);
      setBillingLoaded(true);
      saveBillingCache(fresh);
    } catch (err) {
      console.warn("[MF] Billing fetch failed — using Free fallback:", err);
      setBillingStatus(FREE_FALLBACK);
      setBillingLoaded(true);
    }
  }, []);

  const refreshBilling = useCallback(() => {
    clearBillingCache();
    void performFetch();
  }, [performFetch]);

  useEffect(() => {
    if (!authLoaded) return;

    if (!session) {
      clearBillingCache();
      setBillingStatus(FREE_FALLBACK);
      setBillingLoaded(true);
      return;
    }

    const cached = loadCachedBilling();
    if (cached) {
      console.log("[MF] Billing cache hit");
      setBillingStatus(cached);
      setBillingLoaded(true);
    }

    void performFetch();
  }, [authLoaded, session, performFetch]);

  return { billingStatus, billingLoaded, refreshBilling };
}
