import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const STRIPE_PRICE_PLUS = Deno.env.get("STRIPE_PRICE_PLUS")!;
const STRIPE_PRICE_UNLIMITED = Deno.env.get("STRIPE_PRICE_UNLIMITED")!;

type Tier = "free" | "plus" | "unlimited";

const PRICE_TIER_MAP: Record<string, Tier> = {};
// Populated at runtime so we can handle the env vars being set
function getPriceTierMap(): Record<string, Tier> {
  return {
    [STRIPE_PRICE_PLUS]: "plus",
    [STRIPE_PRICE_UNLIMITED]: "unlimited",
  };
}

const TIER_LIMITS: Record<Tier, number> = {
  free: 10,
  plus: 30,
  unlimited: 9999,
};

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  const body = await req.text();
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const priceTierMap = getPriceTierMap();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const tierId = session.metadata?.tier_id as Tier | undefined;
    if (!userId || !tierId) return new Response("OK", { status: 200 });

    await supabase.from("user_profiles").update({
      tier: tierId,
      subscription_status: "active",
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      max_profiles_per_platform: TIER_LIMITS[tierId] ?? 10,
      cancel_at_period_end: false,
    }).eq("user_id", userId);
  }

  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const priceId = sub.items.data[0]?.price?.id;
    const tier: Tier = priceTierMap[priceId] || "free";

    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id")
      .eq("stripe_subscription_id", sub.id);

    if (profiles && profiles.length > 0) {
      await supabase.from("user_profiles").update({
        tier,
        subscription_status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
        max_profiles_per_platform: TIER_LIMITS[tier],
      }).eq("stripe_subscription_id", sub.id);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;

    await supabase.from("user_profiles").update({
      tier: "free",
      subscription_status: "canceled",
      current_period_end: null,
      cancel_at_period_end: false,
      max_profiles_per_platform: TIER_LIMITS.free,
    }).eq("stripe_subscription_id", sub.id);
  }

  return new Response("OK", { status: 200 });
});
