import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Session } from "./lib/supabase";
import type {
  Network, NetworkStatus, SourcesByNetwork, SourceConfig,
  Post, PricingTier, Tier,
} from "./types";
import { NETWORK_KEYS } from "./types";
import type { BillingResponse } from "./lib/billing";
import { loadHidden, saveHidden, sourceKey, networkKey } from "./lib/storage";
import { formatRelativeTime } from "./lib/format";
import { REFRESH_INTERVAL_MS, POSTS_PER_SOURCE, REFRESH_DEBOUNCE_MS, refreshState } from "./lib/scraping";
import { filterValidPermalinks, dedupePosts } from "./lib/post-filters";
import { BRAND_GRADIENT } from "./lib/theme";
import { useTheme } from "./lib/theme-context";
import { StatusBar } from "./components/StatusBar";
import { CancelBanner } from "./components/CancelBanner";
import { FilterPanel } from "./components/FilterPanel";
import { PostCard } from "./components/PostCard";
import { UpgradeModal } from "./components/UpgradeModal";
import { UserMenu } from "./components/UserMenu";

export function MasterFeedView({
  sources, addSourceToStore, removeSourceFromStore, initialFocusNetwork, onBackToIndex,
  billingStatus, billingLoaded,
  session, authLoaded, onOpenLogin, onLogout, onOpenPortal,
  onOpenSettings,
}: {
  sources: SourcesByNetwork;
  addSourceToStore: (network: Network, name: string, scrapeQuery: string) => Promise<SourceConfig>;
  removeSourceFromStore: (network: Network, sourceId: string) => Promise<void>;
  initialFocusNetwork?: Network | null;
  onBackToIndex: () => void;
  billingStatus: BillingResponse | null;
  billingLoaded: boolean;
  session: Session | null;
  authLoaded: boolean;
  onOpenLogin: (reason?: string) => void;
  onLogout: () => void;
  onOpenPortal: () => Promise<void>;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const [refreshing, setRefreshing] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [status, setStatus] = useState<Record<Network, NetworkStatus>>({
    Facebook: "empty", Instagram: "empty", YouTube: "empty",
  });
  const [focusNetwork, setFocusNetwork] = useState<Network | null>(
    initialFocusNetwork || null
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHidden);

  const [scrapedPosts, setScrapedPosts] = useState<Map<string, Post[]>>(new Map());
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());

  const [upgradeModalNetwork, setUpgradeModalNetwork] = useState<Network | null>(null);

  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);

  // web: posts received via scrapeProfile fetch response

  const scrapeProfile = useCallback(
    async (network: Network, profileName: string, sourceId: string) => {
      const k = networkKey(network);
      const sourcesNow = sourcesRef.current[k] || [];
      const matchingSource = sourcesNow.find((s) => s.id === sourceId);
      if (!matchingSource) {
        console.log(
          `[MF] Discarding scrape for removed source ${sourceId} (${network})`
        );
        setScrapingIds((prev) => {
          if (!prev.has(sourceId)) return prev;
          const next = new Set(prev);
          next.delete(sourceId);
          return next;
        });
        return;
      }
      const sourceName = matchingSource.nazov;

      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scrape-profile`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${session?.access_token ?? ""}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              platform: network.toLowerCase(),
              identifier: profileName,
              sourceId,
            }),
          }
        );
        const data = await resp.json();
        const posts = Array.isArray(data.posts) ? data.posts : [];

        console.log(
          `[MF] Received ${posts.length} post(s) for "${sourceName}" (${network}). ` +
          `Will display up to ${POSTS_PER_SOURCE}.`
        );

        const baseTime = Date.now();
        const allMapped: Post[] = posts.map((p: any, idx: number) => ({
          id: `scrape-${sourceId}-${idx}-${p.id || baseTime}`,
          network,
          sourceId,
          sourceName,
          body: p.content_text || "",
          imageUrl: p.image_url || undefined,
          videoThumbUrl: p.video_url || undefined,
          permalink: p.link_url || p.post_url || p.url || "",
          publishedAt: p.posted_at
            ? new Date(p.posted_at)
            : new Date(baseTime - idx * 1000),
        }));

        const validPermalink = filterValidPermalinks(allMapped, network, sourceName);
        const deduped = dedupePosts(validPermalink, sourceName);
        const mapped = deduped.slice(0, POSTS_PER_SOURCE);

        setScrapedPosts((prev) => {
          const next = new Map(prev);
          next.set(sourceId, mapped);
          return next;
        });
      } catch (e) {
        console.warn(`[MF] scrape "${sourceName}" failed:`, e);
      } finally {
        setScrapingIds((prev) => {
          if (!prev.has(sourceId)) return prev;
          const next = new Set(prev);
          next.delete(sourceId);
          return next;
        });
      }
    },
    [session]
  );

  useEffect(() => { saveHidden(hiddenIds); }, [hiddenIds]);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (now - refreshState.lastRefreshAt < REFRESH_DEBOUNCE_MS) {
      const ago = now - refreshState.lastRefreshAt;
      console.log(`[MF] Refresh debounced — only ${ago}ms since last refresh.`);
      return;
    }
    refreshState.lastRefreshAt = now;

    setRefreshing(true);

    const currentSources = sourcesRef.current;
    const allScrapeSources: Array<{ source: SourceConfig; network: Network }> = [];
    for (const { key, network } of NETWORK_KEYS) {
      for (const s of currentSources[key]) {
        if (s.scrapeQuery) allScrapeSources.push({ source: s, network });
      }
    }

    console.log(`[MF] Refresh started — ${allScrapeSources.length} profile(s) to scrape.`);

    if (allScrapeSources.length > 0) {
      setScrapingIds(new Set(allScrapeSources.map(({ source }) => source.id)));
    } else {
      setScrapingIds(new Set());
    }

    const nextStatus: Record<Network, NetworkStatus> = {
      Facebook: "empty", Instagram: "empty", YouTube: "empty",
    };
    for (const { network } of allScrapeSources) {
      nextStatus[network] = "connected";
    }
    setStatus(nextStatus);

    for (const { source, network } of allScrapeSources) {
      void scrapeProfile(network, source.scrapeQuery!, source.id);
    }

    setTimeout(() => {
      setScrapingIds((prev) => {
        if (prev.size === 0) return prev;
        const stillScraping = new Set(prev);
        allScrapeSources.forEach(({ source }) => stillScraping.delete(source.id));
        if (stillScraping.size !== prev.size) {
          console.log("[MF] Timeout cleanup — niektoré profily neodpovedali do 30s.");
        }
        return stillScraping;
      });
    }, 30000);

    setLastRefresh(new Date());
    setRefreshing(false);
  }, [scrapeProfile]);

  const manualRefresh = useCallback(() => {
    refreshState.lastRefreshAt = 0;
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleSource = useCallback((key: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const addSource = useCallback(
    async (network: Network, name: string, scrapeQuery: string) => {
      if (billingLoaded && billingStatus) {
        const limit = billingStatus.status.max_profiles_per_platform;
        const k = networkKey(network);
        const currentCount = sourcesRef.current[k].length;
        if (currentCount >= limit) {
          console.log(
            `[MF] Limit reached for ${network}: ${currentCount}/${limit} ` +
            `(tier: ${billingStatus.status.tier}). Showing upgrade modal.`
          );
          setUpgradeModalNetwork(network);
          throw new Error("MF_LIMIT_REACHED");
        }
      }

      const newSource = await addSourceToStore(network, name, scrapeQuery);
      setStatus((prev) => ({ ...prev, [network]: "connected" }));

      setScrapingIds((prev) => new Set(prev).add(newSource.id));
      console.log(`[MF] Adding "${name}" (${network}) → triggering scrape...`);
      void scrapeProfile(network, scrapeQuery, newSource.id);

      setTimeout(() => {
        setScrapingIds((prev) => {
          if (!prev.has(newSource.id)) return prev;
          const next = new Set(prev);
          next.delete(newSource.id);
          return next;
        });
      }, 30000);
    },
    [addSourceToStore, billingStatus, billingLoaded, scrapeProfile]
  );

  const removeSource = useCallback(
    (network: Network, sourceId: string) => {
      void removeSourceFromStore(network, sourceId);
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceKey(network, sourceId));
        return next;
      });
      setScrapedPosts((prev) => {
        if (!prev.has(sourceId)) return prev;
        const next = new Map(prev);
        next.delete(sourceId);
        return next;
      });
      setScrapingIds((prev) => {
        if (!prev.has(sourceId)) return prev;
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    },
    [removeSourceFromStore]
  );

  const onClickNetwork = useCallback((n: Network) => {
    setFocusNetwork(null);
    setTimeout(() => setFocusNetwork(n), 0);
  }, []);

  const visiblePosts = useMemo(() => {
    const validIds = new Set<string>();
    for (const { key } of NETWORK_KEYS) {
      for (const s of sources[key]) {
        validIds.add(s.id);
      }
    }

    const perSource: Post[][] = [];
    scrapedPosts.forEach((arr, sourceId) => {
      if (arr.length === 0) return;
      if (!validIds.has(sourceId)) return;
      const network = arr[0].network;
      if (hiddenIds.has(sourceKey(network, sourceId))) return;
      perSource.push(arr);
    });

    if (perSource.length === 0) return [];

    // Flat chronological sort DESC across ALL sources (newest first),
    // replacing the old index-based interleave.
    const allPosts: Post[] = [];
    for (const arr of perSource) {
      allPosts.push(...arr);
    }
    const sorted = allPosts.sort((a, b) => {
      const tA = new Date(a.publishedAt).getTime();
      const tB = new Date(b.publishedAt).getTime();
      return tB - tA;
    });

    return sorted;
  }, [scrapedPosts, hiddenIds, sources]);

  const sourceCounts = useMemo<Record<Network, number>>(() => ({
    Facebook: sources.facebook.length,
    Instagram: sources.instagram.length,
    YouTube: sources.youtube.length,
  }), [sources]);

  const filterCounts = useMemo(() => {
    let total = 0, active = 0;
    for (const { key, network } of NETWORK_KEYS) {
      for (const s of sources[key]) {
        total++;
        if (!hiddenIds.has(sourceKey(network, s.id))) active++;
      }
    }
    return { total, active };
  }, [sources, hiddenIds]);

  const totalSources = filterCounts.total;
  const isAnyScraping = scrapingIds.size > 0;

  // 7D: Handler pre kliknutie na tarifu v upgrade modaly.
  const handlePickTier = useCallback(async (tier: PricingTier) => {
    console.log(`[MF] User picked tier: ${tier.tier_id} (${tier.display_name})`);

    if (!session) {
      setUpgradeModalNetwork(null);
      onOpenLogin();
      return;
    }

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tier_id: tier.tier_id }),
        }
      );
      const { url } = await resp.json();
      console.log(`[MF] Opening Stripe Checkout: ${url}`);
      window.open(url, "_blank");
      setUpgradeModalNetwork(null);
    } catch (err: any) {
      console.error("[MF] Checkout session failed:", err);
      alert(t("errors.paymentFailed", { error: err?.message || err || t("errors.unknown") }));
    }
  }, [session, onOpenLogin, t]);

  return (
    <div style={{
      backgroundColor: c.bg,
      color: c.fg,
      minHeight: "100vh",
      fontFamily: "'Manrope', sans-serif",
      padding: "32px 16px 60px",
    }}>
      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <div>
            <h1 style={{
              margin: "0 0 4px",
              fontSize: 22, fontWeight: 700,
              letterSpacing: "-0.02em",
              color: c.fg,
              fontFamily: "'Manrope', sans-serif",
            }}>
              Meshy<span style={{
                fontFamily: "'Fraunces', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 600,
                background: BRAND_GRADIENT.cssString,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}>Net</span>
            </h1>
            <p style={{
              margin: 0, fontSize: 13, color: c.muted, fontWeight: 400,
              fontFamily: "'Manrope', sans-serif",
            }}>
              {isAnyScraping
                ? t("feed.loadingPosts")
                : lastRefresh
                ? t("feed.updatedAgo", { time: formatRelativeTime(lastRefresh) })
                : t("feed.ready")}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {authLoaded && (
              session ? (
                <UserMenu
                  email={session.user.email || ""}
                  tier={billingStatus?.status.tier || "free"}
                  onLogout={onLogout}
                  onOpenPortal={onOpenPortal}
                  onOpenSettings={onOpenSettings}
                />
              ) : (
                <button
                  onClick={() => onOpenLogin()}
                  style={{
                    background: "transparent",
                    border: `0.5px solid ${c.border}`,
                    color: c.accent,
                    cursor: "pointer",
                    fontSize: 12, fontWeight: 600,
                    padding: "5px 12px",
                    borderRadius: 7,
                    letterSpacing: "0.3px",
                    fontFamily: "'Manrope', sans-serif",
                  }}
                  title={t("feed.loginButton")}
                >
                  {t("feed.loginButton")}
                </button>
              )
            )}
            <button
              onClick={onOpenSettings}
              style={{
                background: "transparent", border: "none",
                color: c.muted, cursor: "pointer",
                fontSize: 15, padding: "4px 6px",
                fontFamily: "inherit",
              }}
              title={t("feed.settingsTitle")}
            >
              ⚙
            </button>
            <button
              onClick={onBackToIndex}
              style={{
                background: "transparent", border: "none",
                color: c.muted, cursor: "pointer",
                fontSize: 16, fontWeight: 500,
                padding: "4px 8px",
                fontFamily: "inherit",
              }}
              title={t("feed.backTitle")}
            >
              ↺
            </button>
          </div>
        </div>

        <StatusBar
          status={status}
          sourceCounts={sourceCounts}
          onRefresh={manualRefresh}
          refreshing={refreshing || isAnyScraping}
          onClickNetwork={onClickNetwork}
        />

        {/* 7E: Cancel banner — viditeľný len ak user zrušil predplatné a stále má
            aktívne obdobie. Tým má info kedy mu plán reálne skončí + ponuka
            znovuobnoviť cez portal. */}
        {billingStatus?.status.cancel_at_period_end &&
         billingStatus.status.current_period_end && (
          <CancelBanner
            endDate={billingStatus.status.current_period_end}
            tier={billingStatus.status.tier}
            onManage={onOpenPortal}
          />
        )}

        <FilterPanel
          sources={sources}
          hiddenIds={hiddenIds}
          focusNetwork={focusNetwork}
          scrapingIds={scrapingIds}
          onToggleSource={toggleSource}
          onAddSource={addSource}
          onRemoveSource={removeSource}
        />

        {totalSources === 0 && (
          <div style={{
            textAlign: "center", padding: "40px 20px",
            color: c.muted, fontSize: 14,
            background: c.bgElevated, border: `0.5px solid ${c.border}`,
            borderRadius: 12,
            fontFamily: "'Manrope', sans-serif",
          }}>
            {t("feed.noSources")}
          </div>
        )}

        {totalSources > 0 && visiblePosts.length === 0 && !isAnyScraping && (
          <div style={{
            textAlign: "center", padding: "40px 20px",
            color: c.muted, fontSize: 14,
            fontFamily: "'Manrope', sans-serif",
          }}>
            {t("feed.noPostsLoaded")}<br />
            {t("feed.noPostsHint")}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {visiblePosts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>

        {visiblePosts.length > 0 && (
          <div style={{
            textAlign: "center", fontSize: 11,
            letterSpacing: "0.4px", color: c.muted,
            marginTop: 20, fontWeight: 500,
            fontFamily: "'Manrope', sans-serif",
          }}>
            {t("feed.endOfFeed")}
          </div>
        )}
      </div>

      {upgradeModalNetwork && billingStatus && (
        <UpgradeModal
          currentTier={billingStatus.status.tier as Tier}
          network={upgradeModalNetwork}
          availableTiers={billingStatus.available_tiers as unknown as PricingTier[]}
          onClose={() => setUpgradeModalNetwork(null)}
          onPickTier={handlePickTier}
        />
      )}
    </div>
  );
}
