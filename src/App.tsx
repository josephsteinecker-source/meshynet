import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase, type Session } from "./lib/supabase";
import type { Network, View, Mode, StatusResponse, SourcesByNetwork } from "./types";
import { loadSources, saveSources, loadMode, saveMode, totalSourceCount } from "./lib/storage";
import { openExternal, openZenMode } from "./lib/tauri";
import { ThemeProvider } from "./lib/theme-context";
import { IndexView } from "./IndexView";
import { MasterFeedView } from "./MasterFeedView";
import { LoginModal } from "./components/LoginModal";
import { SettingsModal } from "./components/SettingsModal";

// ============================================================
// App root
// ============================================================

function App() {
  const [sources, setSourcesState] = useState<SourcesByNetwork>(loadSources);
  const [view, setView] = useState<View>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode")) return "feed";
    } catch {}
    return totalSourceCount(loadSources()) > 0 ? "feed" : "index";
  });
  const [pickedNetwork, setPickedNetwork] = useState<Network | null>(null);
  const [mode, setModeState] = useState<Mode>(loadMode);

  const [billingStatus, setBillingStatus] = useState<StatusResponse | null>(null);
  const [billingLoaded, setBillingLoaded] = useState(false);

  // 7D: Auth state — sledovať či je user prihlásený cez Supabase
  const [session, setSession] = useState<Session | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [loginModalReason, setLoginModalReason] = useState<string | null>(null);
  const loginModalOpen = loginModalReason !== null;

  const [showSettings, setShowSettings] = useState(false);

  // 7D: Pri mount načítaj aktuálnu session (z localStorage) a subscribe
  // na zmeny — po OTP verify sa session automaticky uloží + propagne.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        console.log(`[MF] Auth restored: ${data.session.user.email}`);
      } else {
        console.log("[MF] No active session");
      }
      setAuthLoaded(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.log(`[MF] Auth event: ${event}`, newSession?.user?.email || "(no user)");
      setSession(newSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Billing fetch — čaká na authLoaded a posiela JWT z aktuálnej session.
  // Refetchne sa pri každej auth zmene (SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT),
  // takže `billingStatus` sa drží konzistentne s aktuálnym stavom prihlásenia.
  //
  // Fallback: ak fetch zlyhá, predpokladáme Free tier so 3 profilmi per sieť.
  // To zabezpečí že limit check v addSource nepadne do "fail-open" stavu
  // a neprihlásení / chybový-stav user nemôže pridávať bez limitu.
  useEffect(() => {
    if (!authLoaded) {
      // Ešte čakáme na auth restoration — neflešni billing fetch
      return;
    }

    let cancelled = false;
    const accessToken = session?.access_token || "";

    console.log(
      `[MF] Fetching billing status (session=${session ? "yes" : "no"}, ` +
      `has_token=${accessToken.length > 0})...`
    );

    invoke<StatusResponse>("mf_get_status", { accessToken })
      .then((resp) => {
        if (cancelled) return;
        console.log(
          `[MF] Billing loaded: tier=${resp.status.tier}, ` +
          `max_profiles=${resp.status.max_profiles_per_network}, ` +
          `tiers=${resp.available_tiers.length}`
        );
        setBillingStatus(resp);
        setBillingLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(
          "[MF] Billing fetch failed — using Free fallback (3 profiles/network):",
          err
        );
        // Free-tier fallback — užívateľ stále podlieha limitu, len ho nemôže
        // upgradovať (lebo nemáme available_tiers). To je bezpečnejšie než
        // pôvodný "fail-open" behavior kde billingStatus zostal null a
        // limit check sa preskočil úplne.
        setBillingStatus({
          status: {
            user_id: session?.user?.id ?? null,
            email: session?.user?.email ?? null,
            tier: "free",
            subscription_status: "none",
            current_period_end: null,
            cancel_at_period_end: false,
            max_profiles_per_network: 3,
          },
          available_tiers: [],
        });
        setBillingLoaded(true);
      });

    return () => { cancelled = true; };
  }, [authLoaded, session]);

  const setSources = useCallback((s: SourcesByNetwork) => {
    setSourcesState(s);
    saveSources(s);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    saveMode(m);
  }, []);

  const handlePickNetwork = useCallback((n: Network) => {
    setPickedNetwork(n);
    setView("feed");
    if (mode === "free") {
      openZenMode(n);
    }
  }, [mode]);

  const handleBackToIndex = useCallback(() => {
    setPickedNetwork(null);
    setView("index");
  }, []);

  const openLoginModal = useCallback((reason?: string) => {
    setLoginModalReason(reason || "");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      console.log("[MF] User logged out");
    } catch (err) {
      console.error("[MF] Logout failed:", err);
    }
  }, []);

  // 7E: Otvor Stripe Customer Portal v default browseri.
  // Pre prihlásených platených userov — z UserMenu položky "Spravovať predplatné"
  // a z CancelBanner tlačidla "Obnoviť".
  const handleOpenPortal = useCallback(async () => {
    if (!session) {
      console.warn("[MF] handleOpenPortal: no session, cannot open portal");
      return;
    }
    try {
      const portalUrl = await invoke<string>("mf_create_portal_session", {
        accessToken: session.access_token,
      });
      console.log(`[MF] Opening Stripe Customer Portal: ${portalUrl}`);
      await openExternal(portalUrl);
    } catch (err: any) {
      console.error("[MF] Portal session failed:", err);
      alert(
        `Nepodarilo sa otvoriť správu predplatného.\n\n` +
        `Chyba: ${err?.message || err || "neznáma chyba"}\n\n` +
        `Skús prosím znova alebo nás kontaktuj.`
      );
    }
  }, [session]);

  if (view === "index") {
    return (
      <ThemeProvider>
        <IndexView onPickNetwork={handlePickNetwork} />
        {loginModalOpen && (
          <LoginModal
            reason={loginModalReason || undefined}
            onClose={() => setLoginModalReason(null)}
          />
        )}
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} />
        )}
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <MasterFeedView
        sources={sources}
        setSources={setSources}
        initialFocusNetwork={pickedNetwork}
        onBackToIndex={handleBackToIndex}
        mode={mode}
        setMode={setMode}
        billingStatus={billingStatus}
        billingLoaded={billingLoaded}
        session={session}
        authLoaded={authLoaded}
        onOpenLogin={openLoginModal}
        onLogout={handleLogout}
        onOpenPortal={handleOpenPortal}
        onOpenSettings={() => setShowSettings(true)}
      />
      {loginModalOpen && (
        <LoginModal
          reason={loginModalReason || undefined}
          onClose={() => setLoginModalReason(null)}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </ThemeProvider>
  );
}

export default App;
