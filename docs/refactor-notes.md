# Refactor Notes — Phase A: App.tsx Modularization

## Batch 2 cleanup pass — App.tsx wire-up TODOs

Toto sú zmeny, ktoré sa musia urobiť v App.tsx **po** dokončení všetkých sub-batchov 2a/2b/2c, ako finálny "wire-up" pass. Až po tomto bude App.tsx skutočne používať nové moduly.

### scraping.ts (Batch 2a)
- `mfLastRefreshAt` → `refreshState.lastRefreshAt` (4 call sites)
  - read: riadky ~2023, ~2024
  - write: riadky ~2028, ~2088
- POZOR: pri náhrade neprepisuj identifier v string literáloch (napr. console.log message)
- Konštanty REFRESH_INTERVAL_MS, POSTS_PER_SOURCE, REFRESH_DEBOUNCE_MS — odstrániť lokálne definície, importovať z `./lib/scraping`

### post-filters.ts (Batch 2a)
- `dedupePosts` a `filterValidPermalinks` v App.tsx pracovali na raw `any[]` dátach (pred mapovaním)
- Nové funkcie vyžadujú `Post[]` — call sites treba presunúť ZA mapping, nie kastovať
- Pôvodný flow: `invoke → raw[] → inline dedupe → map to Post[]`
- Nový flow:   `invoke → raw[] → map to Post[] → dedupePosts(posts, sourceName)`
- `applyFilters` — funkcia robí filter + round-robin interleave; zvážiť rename na `buildVisiblePosts` v Batch 2c

### tauri.ts (Batch 2a)
- Inline `invoke("plugin:opener|open_url", ...)` → nahradiť `openExternal(url)`
- Inline `invoke("otvor_prihlasenie", { network })` → nahradiť `openZenMode(network)`

---

## Commit references
- 4b8ca8a — Batch 2a: extract tauri, scraping, post-filters lib modules
