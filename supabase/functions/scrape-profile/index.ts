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
