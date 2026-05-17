import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_PRICE_PLUS = Deno.env.get("STRIPE_PRICE_PLUS")!;
const STRIPE_PRICE_UNLIMITED = Deno.env.get("STRIPE_PRICE_UNLIMITED")!;
const SUCCESS_URL = "https://meshynet.com/account?checkout=success";
const CANCEL_URL = "https://meshynet.com/account?checkout=cancel";

const TIER_PRICE_MAP: Record<string, string> = {
  plus: STRIPE_PRICE_PLUS,
  unlimited: STRIPE_PRICE_UNLIMITED,
};

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: corsHeaders });
  }

  const { tier_id } = await req.json();
  const priceId = TIER_PRICE_MAP[tier_id];
  if (!priceId) {
    return new Response(JSON.stringify({ error: `Unknown tier: ${tier_id}` }), { status: 400, headers: corsHeaders });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

  // Find or create Stripe customer
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .single();

  let customerId: string | undefined = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
    customerId = customer.id;
    await supabase.from("user_profiles").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: SUCCESS_URL,
    cancel_url: CANCEL_URL,
    metadata: { user_id: user.id, tier_id },
  });

  return new Response(
    JSON.stringify({ url: session.url, session_id: session.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
