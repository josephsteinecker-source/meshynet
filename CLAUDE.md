# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MasterFeed is a cross-platform desktop app (Tauri v2 + React + TypeScript) that aggregates social media feeds from Facebook, Instagram, and YouTube into a unified interface. The core mechanic is "Zen mode" — an in-app webview that injects custom JavaScript to scrape posts from within the user's authenticated session.

## Commands

```bash
npm run dev          # Start Vite dev server (port 1420) — frontend only, no Tauri shell
npm run tauri dev    # Full Tauri app with Rust backend (use this for end-to-end testing)
npm run build        # TypeScript check + Vite build
npm run tauri build  # Full desktop app bundle (dmg/exe/deb)
```

Rust backend changes require `tauri dev` to see them — Vite dev alone won't invoke Tauri commands.

## Architecture

### Frontend (`src/`)

- **`App.tsx`** is the main component (~2679 lines). A modular split is in progress (Phase A refactor) — types and utility functions have been extracted, component extraction is next.
- Two views: `index` (source management) and `feed` (aggregated posts display)
- Two modes: `free` (unlimited sources) and `filter` (tier-limited, server-enforced)
- localStorage keys: `mf-sources-v2`, `mf-hidden-sources-v1`, `mf-mode-v1`, `mf-supabase-auth-v1`
- Default sources seeded from `src/pravidla.json` on first load
- Supabase client in `src/lib/supabase.ts`

#### Extracted modules (Phase A Batch 1 — complete)

| File | Contents |
|---|---|
| `src/types/index.ts` | All shared types + `NETWORK_KEYS`, `BRAND_GRADIENT` constants |
| `src/lib/storage.ts` | localStorage helpers: sources, hidden, mode, filter/network expand state |
| `src/lib/format.ts` | `formatRelativeTime`, `formatPlanEndDate`, `isLikelyValidImage`, `hasValidPermalink` |
| `src/lib/youtube.ts` | `extractYouTubeVideoId` |
| `src/lib/supabase.ts` | Supabase client + `Session` type |

#### Phase A Batch 2 — pending

Files to create: `src/lib/tauri.ts`, `src/lib/scraping.ts`, `src/lib/post-filters.ts`  
Components to extract from App.tsx: icons, `Avatar`, `UserMenu`, `StatusBar`, `FilterPanel`, `PostCard`, `CancelBanner`, `UpgradeModal`, `LoginModal`, `IndexView`, `MasterFeedView`

### Backend (`src-tauri/src/`)

- **`lib.rs`** — Tauri app init, webview event hooks, Zen script injection, Tauri commands exposed to frontend (`otvor_prihlasenie`, `get_status`, etc.)
- **`backend.rs`** — Supabase/Stripe HTTP calls, data type definitions (`UserStatus`, `PricingTier`, `StatusResponse`)
- **`main.rs`** — Windows subsystem declaration; delegates entirely to `lib::run()`

### Zen Mode (core feature)

When a user opens a source in Zen mode, Tauri opens the network URL in a managed webview. A JavaScript "zen script" is injected to scrape post content. The script is fetched from a Supabase Edge Function (`zen-script` / `get_zen_script`) at runtime; a v3 fallback is bundled in `lib.rs` for offline use.

### IPC Pattern

Frontend → Rust: `invoke("command_name", { args })` via `@tauri-apps/api/core`  
Rust → Frontend: `listen("event-name", handler)` via Tauri event emitter  
Deep links (OAuth callbacks): handled by `tauri-plugin-deep-link`

### External Services

| Service | Purpose |
|---|---|
| Supabase (rwmeubxvwjtolalmkxbe) | Auth, user profiles, `app_scripts` table |
| Supabase Edge Functions | `create-checkout-session`, `create-portal-session`, script delivery |
| Stripe | Subscription billing (checkout + portal) |

## Key Constraints

- **TypeScript strict mode** is on with `noUnusedLocals` and `noUnusedParameters` — the build will fail on unused identifiers.
- **CSP is disabled** in `tauri.conf.json` — intentional, required for webview script injection.
- Subscription tier limits (max profiles per network) are enforced server-side via `UserStatus`; the frontend reads these from the `get_status` Tauri command response.
- The Supabase publishable key in `backend.rs` and `src/lib/supabase.ts` is the anon/public key — safe to commit.
