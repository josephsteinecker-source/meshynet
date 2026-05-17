// src-tauri/src/backend.rs
//
// Backend connector — komunikácia so Supabase Edge Functions.
// Drží konfiguráciu a poskytuje utility pre volanie endpointov.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

// ============================================================
// 🔧 Konfigurácia (HARDCODED pre teraz, neskôr cez .env)
// ============================================================
pub const SUPABASE_URL: &str = "https://rwmeubxvwjtolalmkxbe.supabase.co";
pub const SUPABASE_PUBLISHABLE_KEY: &str =
    "sb_publishable_iew3IYCyDR1Nla1iyQeQVQ_riibAftF";

pub fn functions_base_url() -> String {
    format!("{}/functions/v1", SUPABASE_URL)
}

// ============================================================
// 📦 Dátové typy
// ============================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserStatus {
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub tier: String,
    pub subscription_status: String,
    pub current_period_end: Option<String>,
    pub cancel_at_period_end: bool,
    pub max_profiles_per_platform: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PricingTier {
    pub tier_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub price_eur: f64,
    pub max_profiles_per_platform: i32,
    pub display_order: i32,
    pub features: Option<JsonValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StatusResponse {
    pub status: UserStatus,
    pub available_tiers: Vec<PricingTier>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ZenScriptResponse {
    pub network: String,
    pub script_version: Option<String>,
    pub script_content: Option<String>,
    pub min_app_version: Option<String>,
    pub activated_at: Option<String>,
    pub message: Option<String>,
}

// 7D: Response od Edge Function `create-checkout-session`.
// Edge Function dostane tier_id a JWT usera, vytvorí Stripe Checkout Session
// a vráti URL kam Tauri appka usera odošle (default browser).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CheckoutSessionResponse {
    pub url: String,
    pub session_id: Option<String>,
}

// 7E: Response od Edge Function `create-portal-session`.
// Stripe Customer Portal je hostovaná stránka kde si user sám spravuje
// predplatné — cancel, reactivation, payment method, invoices, billing history.
// Edge Function dostane JWT usera, vyhľadá Stripe customer ID v DB,
// vytvorí portal session a vráti URL pre browser.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortalSessionResponse {
    pub portal_url: String,
}

// ============================================================
// 🌐 HTTP klient pre Supabase
// ============================================================

fn http_client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()
}

/// Volá Supabase Edge Function s GET requestom.
/// `auth_token` je voliteľný JWT pre prihláseného usera; ak je None, použije sa publishable key.
pub fn call_edge_function_get(
    endpoint: &str,
    auth_token: Option<&str>,
) -> Result<JsonValue, String> {
    let client = http_client().ok_or("HTTP client init failed")?;
    let url = format!("{}/{}", functions_base_url(), endpoint);

    let token = auth_token.unwrap_or(SUPABASE_PUBLISHABLE_KEY);

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .send()
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }

    resp.json::<JsonValue>()
        .map_err(|e| format!("JSON parse error: {}", e))
}

/// Volá Supabase Edge Function s POST requestom (JSON body).
pub fn call_edge_function_post(
    endpoint: &str,
    body: &JsonValue,
    auth_token: Option<&str>,
) -> Result<JsonValue, String> {
    let client = http_client().ok_or("HTTP client init failed")?;
    let url = format!("{}/{}", functions_base_url(), endpoint);

    let token = auth_token.unwrap_or(SUPABASE_PUBLISHABLE_KEY);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }

    resp.json::<JsonValue>()
        .map_err(|e| format!("JSON parse error: {}", e))
}

// ============================================================
// 🎯 Konkrétne API volania
// ============================================================

/// Získa aktuálny status usera (tier, limity, dostupné tarify).
/// Ak `auth_token` je None, vráti default Free tier.
pub fn fetch_status(auth_token: Option<&str>) -> Result<StatusResponse, String> {
    let json = call_edge_function_get("get-my-status", auth_token)?;
    serde_json::from_value::<StatusResponse>(json)
        .map_err(|e| format!("Status deserialize error: {}", e))
}

/// Získa aktuálny zen script zo serveru.
/// `network = "all"` pre cestu A (jeden blob pre všetky platformy).
/// Ak server vráti None alebo dôjde k chybe, volajúci by mal použiť bundled fallback.
pub fn fetch_zen_script() -> Result<ZenScriptResponse, String> {
    let json = call_edge_function_get("get-zen-script/all", None)?;
    serde_json::from_value::<ZenScriptResponse>(json)
        .map_err(|e| format!("Zen script deserialize error: {}", e))
}

/// 7D: Vytvorí Stripe Checkout Session pre upgrade na zadanú tarifu.
///
/// `tier_id` — "plus" alebo "unlimited" (musí mať Stripe price ID v DB)
/// `access_token` — JWT prihláseného usera (zo Supabase session)
///
/// Vráti URL Stripe Checkout stránky, ktorú Tauri appka otvorí v default browseri.
/// Po platbe Stripe redirectne na success URL definovanú v Edge Function,
/// a webhook handler updatne user tier v DB.
pub fn create_checkout_session(
    tier_id: &str,
    access_token: &str,
) -> Result<CheckoutSessionResponse, String> {
    let body = serde_json::json!({
        "tier_id": tier_id,
    });
    let json = call_edge_function_post(
        "create-checkout-session",
        &body,
        Some(access_token),
    )?;
    serde_json::from_value::<CheckoutSessionResponse>(json)
        .map_err(|e| format!("Checkout session deserialize error: {}", e))
}

/// 7E: Vytvorí Stripe Customer Portal session.
///
/// `access_token` — JWT prihláseného usera (zo Supabase session)
///
/// Customer Portal je hostovaná Stripe stránka kde si user sám spravuje
/// všetky aspekty predplatného:
///   - zrušenie predplatného (cancel at period end)
///   - obnovenie zrušeného predplatného
///   - upgrade/downgrade plánu
///   - zmena platobnej metódy
///   - história faktúr (s možnosťou stiahnuť PDF)
///   - aktualizácia billing údajov
///
/// Stripe automaticky generuje invoices, posiela emaily, rieši VAT compliance
/// a refundy podľa EU regulácií. Po dokončení Stripe redirectuje usera späť
/// na return_url (https://meshynet.com/account).
///
/// Stripe webhook (`stripe-webhook` Edge Function) automaticky updatne
/// `user_profiles.tier` v DB pri každej zmene, takže klient vidí čerstvé
/// dáta pri ďalšom `fetch_status()` volaní.
pub fn create_portal_session(
    access_token: &str,
) -> Result<PortalSessionResponse, String> {
    let body = serde_json::json!({
        "return_url": "https://meshynet.com/account"
    });
    let json = call_edge_function_post(
        "create-portal-session",
        &body,
        Some(access_token),
    )?;
    serde_json::from_value::<PortalSessionResponse>(json)
        .map_err(|e| format!("Portal session deserialize error: {}", e))
}