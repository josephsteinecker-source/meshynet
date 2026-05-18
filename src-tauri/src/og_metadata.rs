// src-tauri/src/og_metadata.rs
//
// Fetches OpenGraph metadata from external article URLs.
// Used by FB and IG scrapers to enrich posts that have an external link
// but are missing imageUrl or meaningful body text.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Clone)]
pub struct OgMetadata {
    pub image: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
}

static OG_CACHE: OnceLock<Mutex<HashMap<String, OgMetadata>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, OgMetadata>> {
    OG_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fetches OG metadata from `url`. Results are cached in-process (cleared on app restart).
/// Returns Err on timeout, DNS failure, non-HTML response, or any network error.
/// Missing OG tags result in Ok(OgMetadata { image: None, title: None, description: None }).
pub fn fetch_og(url: &str) -> Result<OgMetadata, String> {
    if let Ok(guard) = cache().lock() {
        if let Some(cached) = guard.get(url) {
            println!("[MF OG] cache hit {}", trunc(url, 80));
            return Ok(cached.clone());
        }
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15")
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9,sk;q=0.8")
        .send()
        .map_err(|e| {
            println!("[MF OG] timeout/failed {}: {}", trunc(url, 80), e);
            format!("request: {}", e)
        })?;

    let ct = resp.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if !ct.is_empty() && !ct.contains("text/html") {
        println!("[MF OG] timeout/failed {} (non-HTML: {})", trunc(url, 80), ct);
        return Err(format!("non-HTML: {}", ct));
    }

    let html = resp.text().map_err(|e| {
        println!("[MF OG] timeout/failed {} (read): {}", trunc(url, 80), e);
        format!("body read: {}", e)
    })?;

    let image = find_meta(&html, "og:image")
        .or_else(|| find_meta(&html, "twitter:image"));
    let title = find_meta(&html, "og:title")
        .or_else(|| find_meta(&html, "twitter:title"));
    let description = find_meta(&html, "og:description")
        .or_else(|| find_meta(&html, "twitter:description"));

    println!("[MF OG] fetch {} → image={}, title={}",
        trunc(url, 80), image.is_some(), title.is_some());

    let meta = OgMetadata { image, title, description };

    if let Ok(mut guard) = cache().lock() {
        guard.insert(url.to_string(), meta.clone());
    }

    Ok(meta)
}

/// Returns true if this URL should be skipped (social media internal links or direct media files).
pub fn should_skip(url: &str) -> bool {
    let lower = url.to_lowercase();
    if lower.contains("facebook.com") || lower.contains("fb.com") || lower.contains("fb.me")
        || lower.contains("instagram.com") || lower.contains("twitter.com")
        || lower.contains("t.co/") || lower.contains("x.com/")
        || lower.contains("fbcdn.net") || lower.contains("fbsbx.com")
    {
        return true;
    }
    let path = lower.split('?').next().unwrap_or(&lower);
    for ext in &["jpg", "jpeg", "png", "gif", "webp", "svg", "pdf", "mp4", "mp3", "mov"] {
        if path.ends_with(&format!(".{}", ext)) {
            return true;
        }
    }
    false
}

/// Removes every `https://` token from `text`, leaving only the surrounding prose.
/// Used to judge whether a post body is "junk" (basically just a CTA + link)
/// without depending on the exact URL variant we happen to hold.
pub fn strip_urls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find("https://") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos..];
        let end = after.find(|c: char| {
            c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '>' | '<' | '\n' | '\r')
        }).unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Extracts the first `https://` URL from free text (e.g. "Čítajte viac: https://dennikn.sk/...").
pub fn extract_external_url(text: &str) -> Option<String> {
    let start = text.find("https://")?;
    let after = &text[start..];
    let end = after.find(|c: char| {
        c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '>' | '<' | '\n' | '\r')
    }).unwrap_or(after.len());
    let url = after[..end].trim_end_matches(|c| matches!(c, '.' | ',' | ';' | ':' | ')'));
    if url.len() > 12 { Some(url.to_string()) } else { None }
}

// Searches for a <meta property="prop" content="..."> or <meta name="prop" content="..."> tag.
// Handles both attribute orderings (content before or after property/name).
fn find_meta(html: &str, prop: &str) -> Option<String> {
    let attrs: [String; 4] = [
        format!("property=\"{}\"", prop),
        format!("name=\"{}\"", prop),
        format!("property='{}'", prop),
        format!("name='{}'", prop),
    ];
    for attr in &attrs {
        if let Some(pos) = html.find(attr.as_str()) {
            // Confine the search to the single <meta …> tag that matched.
            // Scanning a fixed byte window would bleed into an adjacent
            // sibling tag (e.g. a preceding `<meta property="og:locale"
            // content="sk_SK">`) and pick up the wrong content value.
            let tag_start = html[..pos].rfind('<').unwrap_or(pos);
            let tag_end = html[pos..]
                .find('>')
                .map(|i| pos + i)
                .unwrap_or(html.len());
            let scan = &html[tag_start..tag_end];
            for (open, close) in &[(r#"content=""#, '"'), ("content='", '\'')] {
                if let Some(cp) = scan.find(open) {
                    let after = &scan[cp + open.len()..];
                    if let Some(end) = after.find(*close) {
                        let val = &after[..end];
                        if !val.is_empty() {
                            return Some(decode_entities(val));
                        }
                    }
                }
            }
        }
    }
    None
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x2F;", "/")
        .replace("&#xA;", "\n")
}

fn trunc(s: &str, n: usize) -> &str {
    if s.len() <= n { s } else { &s[..n] }
}
