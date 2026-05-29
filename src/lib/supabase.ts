// ============================================================
// Supabase client setup
// ============================================================
// Singleton client for browser-side auth + DB queries.
// Same project as backend (Edge Functions, app_scripts), but uses
// the ANON key — RLS controls what authenticated users can see.
//
// Pri pridaní backendu (subscriptions, profile, atď.), používaj:
//   import { supabase } from "./lib/supabase";
//   const { data, error } = await supabase.from('user_profiles')...
// ============================================================

import { createClient, type Session } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persistovať session do localStorage — user zostane prihlásený medzi reštartmi appky
    persistSession: true,
    // Storage key (zámerne taký aby kolidoval s ničím MF-špecifickým)
    storageKey: "mf-supabase-auth-v1",
    // Auto-refresh access tokenu (default true, ale explicit pre clarity)
    autoRefreshToken: true,
    // Detekcia URL pre OAuth/magic link callback handlerov
    // V Tauri appke magic link redirectne na špeciálnu URL ktorú prevezme deep-link handler
    detectSessionInUrl: true,
  },
});

export type { Session };