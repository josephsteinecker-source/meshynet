import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FREE_LIMIT = 10;

type Tier = "free" | "plus" | "unlimited";

interface UserStatus {
  user_id: string | null;
  email: string | null;
  tier: Tier;
  subscription_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  max_profiles_per_platform: number;
}

interface PricingTier {
  tier_id: string;
  display_name: string;
  description: string | null;
  price_eur: number;
  max_profiles_per_platform: number;
  display_order: number;
  features: unknown | null;
}

const FREE_STATUS: UserStatus = {
  user_id: null,
  email: null,
  tier: "free",
  subscription_status: "none",
  current_period_end: null,
  cancel_at_period_end: false,
  max_profiles_per_platform: FREE_LIMIT,
};

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Extract JWT from Authorization header
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  // Fetch all available (paid) tiers for the response
  const { data: tiers } = await supabase
    .from("pricing_tiers")
    .select("*")
    .order("display_order");

  const availableTiers: PricingTier[] = (tiers || []).map((t: any) => ({
    tier_id: t.tier_id,
    display_name: t.display_name,
    description: t.description ?? null,
    price_eur: t.price_eur,
    max_profiles_per_platform: t.max_profiles_per_platform,
    display_order: t.display_order,
    features: t.features ?? null,
  }));

  if (!token) {
    return new Response(
      JSON.stringify({ status: FREE_STATUS, available_tiers: availableTiers }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate JWT and get user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(
      JSON.stringify({ status: FREE_STATUS, available_tiers: availableTiers }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("tier, subscription_status, current_period_end, cancel_at_period_end, max_profiles_per_platform")
    .eq("user_id", user.id)
    .single();

  const tier: Tier = (profile?.tier as Tier) || "free";
  const maxProfiles: number = profile?.max_profiles_per_platform ?? FREE_LIMIT;

  const status: UserStatus = {
    user_id: user.id,
    email: user.email ?? null,
    tier,
    subscription_status: profile?.subscription_status ?? "none",
    current_period_end: profile?.current_period_end ?? null,
    cancel_at_period_end: profile?.cancel_at_period_end ?? false,
    max_profiles_per_platform: maxProfiles,
  };

  return new Response(
    JSON.stringify({ status, available_tiers: availableTiers }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
