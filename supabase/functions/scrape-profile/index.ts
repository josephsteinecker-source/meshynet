import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCRAPER_API_URL = Deno.env.get("SCRAPER_API_URL")!;
const SCRAPER_API_KEY = Deno.env.get("SCRAPER_API_KEY")!;

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

  const { platform, identifier } = await req.json();
  if (!platform || !identifier) {
    return new Response(
      JSON.stringify({ error: "platform and identifier are required" }),
      { status: 400, headers: corsHeaders }
    );
  }

  const scraperResp = await fetch(`${SCRAPER_API_URL}/api/v1/scrape`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SCRAPER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform, identifier }),
  });

  const body = await scraperResp.text();
  return new Response(body, {
    status: scraperResp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
