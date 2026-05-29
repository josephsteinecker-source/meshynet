import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase, type Session } from "./lib/supabase";
import type { View, SourcesByNetwork } from "./types";
import { loadSources, saveSources, totalSourceCount } from "./lib/storage";
import { useBilling } from "./hooks/useBilling";
import { ThemeProvider } from "./lib/theme-context";
import { IndexView } from "./IndexView";
import { MasterFeedView } from "./MasterFeedView";
import { LoginModal } from "./components/LoginModal";
import { SettingsModal } from "./components/SettingsModal";

// ============================================================
// App root
// ============================================================

function App() {
  const { t } = useTranslation();
  const [sources, setSourcesState] = useState<SourcesByNetwork>(loadSources);
  const [view, setView] = useState<View>(() =>
    totalSourceCount(loadSources()) > 0 ? "feed" : "index"
  );

  // 7D: Auth state — sledovať či je user prihlásený cez Supabase
  const [session, setSession] = useState<Session | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const { billingStatus, billingLoaded, refreshBilling } = useBilling(session, authLoaded);
  void refreshBilling;

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

  const setSources = useCallback((s: SourcesByNetwork) => {
    setSourcesState(s);
    saveSources(s);
  }, []);

  const handleEnterFeed = useCallback(() => {
    setView("feed");
  }, []);

  const handleBackToIndex = useCallback(() => {
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
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-portal-session`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const { url } = await resp.json();
      console.log(`[MF] Opening Stripe Customer Portal: ${url}`);
      window.open(url, "_blank");
    } catch (err: any) {
      console.error("[MF] Portal session failed:", err);
      alert(t("errors.portalFailed", { error: err?.message || err || t("errors.unknown") }));
    }
  }, [session]);

  if (view === "index") {
    return (
      <ThemeProvider>
        <IndexView onEnter={() => openLoginModal()} />
        {loginModalOpen && (
          <LoginModal
            reason={loginModalReason || undefined}
            onClose={() => setLoginModalReason(null)}
            onAuthed={handleEnterFeed}
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
        onBackToIndex={handleBackToIndex}
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
