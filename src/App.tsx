import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { supabase, type Session } from "./lib/supabase";
import type {
  Network, View, Mode, PricingTier, StatusResponse,
  SourceConfig, SourcesByNetwork, NetworkStatus, Post,
} from "./types";
import { NETWORK_KEYS, BRAND_GRADIENT } from "./types";
import {
  loadSources, saveSources, loadHidden, saveHidden, loadMode, saveMode,
  sourceKey, networkKey, totalSourceCount, generateId,
  loadFilterExpanded, saveFilterExpanded, loadNetworkExpanded, saveNetworkExpanded,
} from "./lib/storage";
import { formatRelativeTime, formatPlanEndDate, isLikelyValidImage, hasValidPermalink } from "./lib/format";
import { extractYouTubeVideoId } from "./lib/youtube";

// ============================================================
// 🎨 MASTER FEED — Index + scraping aggregator s mutable sources
// ============================================================

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const POSTS_PER_SOURCE = 3;

let mfLastRefreshAt = 0;
const REFRESH_DEBOUNCE_MS = 2000;

const PLACEHOLDER_BY_NETWORK: Record<Network, string> = {
  Facebook: "Meno Facebook stránky (napr. fender)",
  Instagram: "Instagram username (napr. fender)",
  YouTube: "YouTube @handle (napr. fendermusic)",
};

const HINT_BY_NETWORK: Record<Network, string> = {
  Facebook: "Zadaj presne tak, ako sa zobrazuje v URL stránky (bez https://facebook.com/).",
  Instagram: "Zadaj Instagram username (bez @, bez URL).",
  YouTube: "Zadaj YouTube @handle (bez @, bez URL).",
};


// ============================================================
// Helpers
// ============================================================

async function openExternal(url: string) {
  if (!url) return;
  try {
    await invoke("plugin:opener|open_url", { url });
    return;
  } catch {}
  try {
    window.open(url, "_blank");
  } catch {}
}

async function openZenMode(network: Network) {
  try {
    await invoke("otvor_prihlasenie", { network });
  } catch (err) {
    console.error(`[Master Feed] Failed to open ${network} in zen mode:`, err);
  }
}


// ============================================================
// Icons
// ============================================================

function EyeIcon({ active }: { active: boolean }) {
  const color = active ? "#34c759" : "#c7c7cc";
  if (active) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0071e3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="16"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0071e3" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "mf-spin 1s linear infinite" }}>
      <style>{`@keyframes mf-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  );
}

function ChevronIcon({ expanded, size = 18, color = "#86868b" }: {
  expanded: boolean;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 220ms ease",
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ============================================================
// 7C: Upgrade Modal — minimalistický Apple-style
// ============================================================

function UpgradeModal({
  currentTier,
  currentLimit,
  network,
  availableTiers,
  onClose,
  onPickTier,
}: {
  currentTier: string;
  currentLimit: number;
  network: Network;
  availableTiers: PricingTier[];
  onClose: () => void;
  onPickTier: (tier: PricingTier) => void;
}) {
  const upgradableTiers = useMemo(
    () =>
      availableTiers
        .filter((t) => t.tier_id !== currentTier && t.max_profiles_per_network > currentLimit)
        .sort((a, b) => a.display_order - b.display_order),
    [availableTiers, currentTier, currentLimit]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2147483647,
        padding: 20,
        animation: "mf-fadein 180ms ease",
      }}
    >
      <style>{`
        @keyframes mf-fadein { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mf-slidein { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: 18,
          padding: "32px 28px 24px",
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          animation: "mf-slidein 220ms ease",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.3px",
            color: "#1d1d1f",
            textAlign: "center",
          }}
        >
          Maximum profilov dosiahnuté
        </h2>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 13,
            color: "#86868b",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {network} · {currentLimit} {currentLimit === 1 ? "profil" : currentLimit < 5 ? "profily" : "profilov"}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {upgradableTiers.map((tier) => (
            <UpgradeTierButton key={tier.tier_id} tier={tier} onClick={() => onPickTier(tier)} />
          ))}
          {upgradableTiers.length === 0 && (
            <div
              style={{
                fontSize: 13,
                color: "#86868b",
                textAlign: "center",
                padding: "20px 0",
              }}
            >
              Nie sú dostupné žiadne vyššie tarify.
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            color: "#86868b",
            fontSize: 13,
            fontWeight: 500,
            padding: "10px 0",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Možno neskôr
        </button>
      </div>
    </div>
  );
}

function UpgradeTierButton({
  tier,
  onClick,
}: {
  tier: PricingTier;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const priceLabel =
    tier.price_eur === 0
      ? "Zdarma"
      : `${tier.price_eur.toFixed(2).replace(".", ",")} € / mes.`;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 16px",
        background: hovered ? "#f5f5f7" : "#ffffff",
        border: "0.5px solid rgba(0,0,0,0.12)",
        borderRadius: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 160ms ease, border-color 160ms ease",
      }}
    >
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: "#1d1d1f" }}>
          {tier.display_name}
        </div>
        <div style={{ fontSize: 12, color: "#86868b", marginTop: 2 }}>
          {tier.max_profiles_per_network} profilov per sieť
        </div>
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#0071e3",
          whiteSpace: "nowrap",
        }}
      >
        {priceLabel}
      </div>
    </button>
  );
}
// ============================================================
// 7D: Login Modal — OTP kód email auth (Tauri-compatible)
//
// Magic link nefunguje v Tauri appkách: link sa otvorí v default browseri,
// kde sa session uloží do localStorage browsera. Tauri webview má svoj
// vlastný izolovaný localStorage a tú session nevidí. Riešenie: OTP kód
// (6 čísel). User dostane kód v emaily, zadá ho priamo v Tauri appke,
// Supabase vráti session — všetko bez redirectu, bez browsera.
// ============================================================

type LoginStage = "email" | "sending_email" | "code" | "verifying" | "error";

function LoginModal({
  reason,
  onClose,
}: {
  reason?: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<LoginStage>("email");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValidCode = /^\d{6,10}$/.test(code.trim());

  // Krok 1: pošli OTP kód na email
  const handleSendCode = async () => {
    if (!isValidEmail || stage === "sending_email") return;
    setStage("sending_email");
    setErrorMsg("");
    try {
      // shouldCreateUser: true → ak user neexistuje, vytvorí sa.
      // Trigger handle_new_user v DB automaticky vytvorí user_profile s tier='free'.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) {
        console.error("[MF] OTP send failed:", error);
        setErrorMsg(error.message || "Nepodarilo sa odoslať kód. Skús znova.");
        setStage("error");
        return;
      }
      console.log("[MF] OTP code sent to:", email);
      setStage("code");
    } catch (err: any) {
      console.error("[MF] OTP send unexpected error:", err);
      setErrorMsg(err?.message || "Nečakaná chyba. Skús znova.");
      setStage("error");
    }
  };

  // Krok 2: over OTP kód → Supabase vráti session (uloží sa do Tauri localStorage)
  const handleVerifyCode = async () => {
    if (!isValidCode || stage === "verifying") return;
    setStage("verifying");
    setErrorMsg("");
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: "email",
      });
      if (error) {
        console.error("[MF] OTP verify failed:", error);
        setErrorMsg(
          /invalid|expired/i.test(error.message)
            ? "Kód je nesprávny alebo už expiroval. Skontroluj e-mail."
            : error.message || "Overenie zlyhalo. Skús znova."
        );
        setStage("error");
        return;
      }
      console.log("[MF] OTP verified, user:", data.user?.email);
      // onAuthStateChange v App komponente automaticky updatne session state,
      // modal sa zavrie a UI prejde do prihláseného stavu.
      onClose();
    } catch (err: any) {
      console.error("[MF] OTP verify unexpected error:", err);
      setErrorMsg(err?.message || "Nečakaná chyba. Skús znova.");
      setStage("error");
    }
  };

  const showEmailStage = stage === "email" || stage === "sending_email"
    || (stage === "error" && !code);
  const showCodeStage = stage === "code" || stage === "verifying"
    || (stage === "error" && code);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2147483647,
        padding: 20,
        animation: "mf-fadein 180ms ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: 18,
          padding: "32px 28px 24px",
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          animation: "mf-slidein 220ms ease",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {showEmailStage && (
          // Krok 1: zadaj email
          <>
            <h2
              style={{
                margin: "0 0 6px",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.3px",
                color: "#1d1d1f",
                textAlign: "center",
              }}
            >
              Prihlásenie
            </h2>
            <p
              style={{
                margin: "0 0 24px",
                fontSize: 13,
                color: "#86868b",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {reason || "Pošleme ti 6-miestny kód na e-mail. Žiadne heslá."}
            </p>

            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (stage === "error") setStage("email");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidEmail) handleSendCode();
              }}
              placeholder="tvoj@email.sk"
              autoFocus
              disabled={stage === "sending_email"}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: "#f5f5f7",
                border: stage === "error"
                  ? "0.5px solid #ff3b30"
                  : "0.5px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
                fontSize: 14,
                color: "#1d1d1f",
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />

            {stage === "error" && (
              <div
                style={{
                  fontSize: 12,
                  color: "#ff3b30",
                  marginBottom: 12,
                  paddingLeft: 4,
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleSendCode}
              disabled={!isValidEmail || stage === "sending_email"}
              style={{
                width: "100%",
                background: isValidEmail && stage !== "sending_email" ? "#0071e3" : "#c7c7cc",
                border: "none",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                padding: "12px 0",
                cursor: isValidEmail && stage !== "sending_email" ? "pointer" : "default",
                borderRadius: 10,
                fontFamily: "inherit",
                marginBottom: 8,
                transition: "background 160ms ease",
              }}
            >
              {stage === "sending_email" ? "Odosielam kód…" : "Poslať kód"}
            </button>

            <button
              onClick={onClose}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#86868b",
                fontSize: 13,
                fontWeight: 500,
                padding: "10px 0",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Možno neskôr
            </button>
          </>
        )}

        {showCodeStage && (
          // Krok 2: zadaj 6-miestny kód
          <>
            <h2
              style={{
                margin: "0 0 6px",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.3px",
                color: "#1d1d1f",
                textAlign: "center",
              }}
            >
              Zadaj kód
            </h2>
            <p
              style={{
                margin: "0 0 24px",
                fontSize: 13,
                color: "#86868b",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Poslali sme 6-miestny kód na <strong>{email}</strong>.
            </p>

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/\D/g, "").slice(0, 10);
                setCode(cleaned);
                if (stage === "error") setStage("code");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidCode) handleVerifyCode();
              }}
              placeholder="123456"
              autoFocus
              disabled={stage === "verifying"}
              style={{
                width: "100%",
                padding: "14px 14px",
                background: "#f5f5f7",
                border: stage === "error"
                  ? "0.5px solid #ff3b30"
                  : "0.5px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
                fontSize: 22,
                fontWeight: 600,
                color: "#1d1d1f",
                fontFamily: '"SF Mono", "Menlo", monospace',
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
                letterSpacing: "8px",
                textAlign: "center",
              }}
            />

            {stage === "error" && (
              <div
                style={{
                  fontSize: 12,
                  color: "#ff3b30",
                  marginBottom: 12,
                  paddingLeft: 4,
                  textAlign: "center",
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleVerifyCode}
              disabled={!isValidCode || stage === "verifying"}
              style={{
                width: "100%",
                background: isValidCode && stage !== "verifying" ? "#0071e3" : "#c7c7cc",
                border: "none",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                padding: "12px 0",
                cursor: isValidCode && stage !== "verifying" ? "pointer" : "default",
                borderRadius: 10,
                fontFamily: "inherit",
                marginBottom: 8,
                transition: "background 160ms ease",
              }}
            >
              {stage === "verifying" ? "Overujem…" : "Prihlásiť"}
            </button>

            <button
              onClick={() => {
                setCode("");
                setErrorMsg("");
                setStage("email");
              }}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#86868b",
                fontSize: 13,
                fontWeight: 500,
                padding: "10px 0",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Použiť iný e-mail
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 7D + 7E: User menu — dropdown s emailom, plánom a akciami (Spravovať
// predplatné, Odhlásiť sa)
// ============================================================

function UserMenu({
  email,
  tier,
  onLogout,
  onOpenPortal,
}: {
  email: string;
  tier: string;
  onLogout: () => void;
  onOpenPortal: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const initial = email.charAt(0).toUpperCase() || "·";
  const isPaid = tier !== "free" && tier !== "";

  const tierLabel = (() => {
    if (tier === "free" || !tier) return "Free";
    // Capitalize first letter for display ("standard" → "Standard")
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  })();

  const handlePortalClick = async () => {
    if (portalLoading) return;
    setPortalLoading(true);
    try {
      await onOpenPortal();
      setOpen(false);
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={email}
        style={{
          width: 28, height: 28, borderRadius: "50%",
          background: BRAND_GRADIENT,
          color: "#ffffff",
          border: "none",
          cursor: "pointer",
          fontSize: 12, fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "#ffffff",
            border: "0.5px solid rgba(0,0,0,0.08)",
            borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
            minWidth: 220,
            padding: "8px 0",
            zIndex: 1000,
          }}
        >
          {/* Email + tier badge */}
          <div
            style={{
              padding: "4px 14px 10px",
              borderBottom: "0.5px solid rgba(0,0,0,0.06)",
            }}
          >
            <div style={{
              fontSize: 11,
              color: "#86868b",
              wordBreak: "break-all",
              lineHeight: 1.4,
              marginBottom: 4,
            }}>
              {email}
            </div>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: isPaid ? "transparent" : "#86868b",
              backgroundImage: isPaid ? BRAND_GRADIENT : undefined,
              WebkitBackgroundClip: isPaid ? "text" : undefined,
              backgroundClip: isPaid ? "text" : undefined,
              letterSpacing: "0.3px",
              textTransform: "uppercase",
            }}>
              {tierLabel} plán
            </div>
          </div>

          {/* Spravovať predplatné — len pre platených userov */}
          {isPaid && (
            <button
              onClick={handlePortalClick}
              disabled={portalLoading}
              style={{
                display: "block",
                width: "100%",
                background: "transparent",
                border: "none",
                padding: "10px 14px",
                fontSize: 13,
                color: portalLoading ? "#c7c7cc" : "#1d1d1f",
                fontFamily: "inherit",
                cursor: portalLoading ? "default" : "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (!portalLoading) e.currentTarget.style.background = "#f5f5f7";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {portalLoading ? "Otváram…" : "Spravovať predplatné"}
            </button>
          )}

          <button
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              display: "block",
              width: "100%",
              background: "transparent",
              border: "none",
              padding: "10px 14px",
              fontSize: 13,
              color: "#1d1d1f",
              fontFamily: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f7")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Odhlásiť sa
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Avatar
// ============================================================

function Avatar({ name, src }: { name: string; src?: string }) {
  const [error, setError] = useState(false);
  const showImage = src && !error;

  if (showImage) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setError(true)}
        style={{
          width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
        }}
      />
    );
  }

  const initials = name
    .replace(/^[@#]/, "")
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");

  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const bg = `hsl(${hue}, 55%, 78%)`;
  const fg = `hsl(${hue}, 50%, 28%)`;

  return (
    <div style={{
      width: 38, height: 38, borderRadius: "50%", background: bg, color: fg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 600, fontSize: 13, flexShrink: 0,
    }}>
      {initials || "·"}
    </div>
  );
}

// ============================================================
// Index View
// ============================================================

function IndexView({ onPickNetwork }: { onPickNetwork: (n: Network) => void }) {
  return (
    <div style={{
      backgroundColor: "#ffffff",
      color: "#1d1d1f",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: "40px 20px",
    }}>
      <img
        src="/MeshyNet_logo.svg"
        alt="MeshyNet"
        style={{ width: 280, height: "auto", marginBottom: 24 }}
        onError={(e) => {
          (e.currentTarget.style as any).display = "none";
        }}
      />

      <h1 style={{
        margin: "0 0 14px",
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: "5px",
        background: BRAND_GRADIENT,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        lineHeight: 1.1,
      }}>
        MASTER FEED
      </h1>

      <p style={{
        margin: "0 0 48px",
        color: "#86868b",
        fontSize: 14,
        fontWeight: 400,
        textAlign: "center",
        maxWidth: 380,
        lineHeight: 1.5,
      }}>
        Tichý priestor pre obsah, ktorý si vyberáš.
        <br />Vyber sieť a začni.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {(["Facebook", "Instagram", "YouTube"] as Network[]).map((n) => (
          <BigNetworkButton key={n} network={n} onClick={() => onPickNetwork(n)} />
        ))}
      </div>
    </div>
  );
}

function BigNetworkButton({
  network, onClick,
}: {
  network: Network; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 340,
        padding: "20px 28px",
        borderRadius: 18,
        background: BRAND_GRADIENT,
        color: "#ffffff",
        border: "none",
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        boxShadow: hovered
          ? "0 12px 32px rgba(64, 97, 173, 0.32)"
          : "0 6px 20px rgba(64, 97, 173, 0.22)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "transform 220ms ease, box-shadow 220ms ease",
      }}
    >
      {network}
    </button>
  );
}

// ============================================================
// Add source form
// ============================================================

function AddSourceForm({
  network,
  onAdd,
  inputRef,
}: {
  network: Network;
  onAdd: (name: string, scrapeQuery: string) => Promise<void> | void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeholder = PLACEHOLDER_BY_NETWORK[network];
  const hint = HINT_BY_NETWORK[network];

  const trimmed = value.trim();
  const canSubmit = !busy && trimmed.length >= 2;

  const handleAdd = async () => {
    if (!canSubmit) return;

    if (/^https?:\/\//i.test(trimmed) || trimmed.includes(" ")) {
      setError("Zadaj len meno profilu, nie URL ani medzery.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const cleanName = trimmed.replace(/^@/, "").replace(/\/+$/, "");
      await onAdd(cleanName, cleanName);
      setValue("");
    } catch (e: any) {
      if (e?.message === "MF_LIMIT_REACHED") {
        // No-op — parent zobrazil upgrade modal
      } else {
        setError("Nepodarilo sa pridať. Skús znova.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        background: "#f5f5f7",
        border: error
          ? "0.5px solid #ff9500"
          : "0.5px solid rgba(0,0,0,0.06)",
        borderRadius: 10,
        transition: "border-color 200ms ease",
      }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={placeholder}
          disabled={busy}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 14,
            color: "#1d1d1f",
            fontFamily: "inherit",
            padding: "4px 0",
          }}
        />
        <button
          onClick={handleAdd}
          disabled={!canSubmit}
          title={canSubmit ? `Pridať ${network} profil` : "Zadaj meno profilu"}
          style={{
            background: "transparent",
            border: "none",
            padding: 4,
            cursor: canSubmit ? "pointer" : "default",
            opacity: canSubmit ? 1 : 0.4,
            display: "flex",
            alignItems: "center",
          }}
        >
          <PlusIcon />
        </button>
      </div>

      {error ? (
        <div style={{
          fontSize: 12,
          color: "#ff9500",
          marginTop: 6,
          paddingLeft: 4,
        }}>
          {error}
        </div>
      ) : (
        <div style={{
          fontSize: 11,
          color: "#86868b",
          marginTop: 6,
          paddingLeft: 4,
          lineHeight: 1.4,
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Source row
// ============================================================

function SourceRow({
  source, enabled, onToggle, onRemove, isScraping,
}: {
  source: SourceConfig;
  enabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
  isScraping?: boolean;
}) {
  const isScrapeSource = !!source.scrapeQuery;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 0",
    }}>
      {isScrapeSource && isScraping && (
        <span title="Načítavam najnovšie posty…" style={{ display: "inline-flex" }}>
          <SpinnerIcon />
        </span>
      )}
      {isScrapeSource && !isScraping && (
        <span title="Profil zo sociálnej siete" style={{
          fontSize: 11,
          color: "#0071e3",
          fontWeight: 600,
          letterSpacing: "0.3px",
          padding: "2px 6px",
          background: "rgba(0,113,227,0.08)",
          borderRadius: 4,
        }}>
          @
        </span>
      )}
      <span style={{
        flex: 1,
        fontSize: 14,
        color: enabled ? "#1d1d1f" : "#86868b",
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        transition: "color 200ms ease",
      }}>
        {source.nazov}
      </span>
      <button
        onClick={onToggle}
        title={enabled ? "Skryť" : "Zobraziť"}
        style={{
          background: "transparent",
          border: "none",
          padding: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <EyeIcon active={enabled} />
      </button>
      <button
        onClick={onRemove}
        title="Odobrať"
        style={{
          background: "transparent",
          border: "none",
          padding: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <MinusIcon />
      </button>
    </div>
  );
}

// ============================================================
// Filter panel — collapsible (2 levely: panel + per-network)
// ============================================================


function FilterPanel({
  sources, hiddenIds, focusNetwork, scrapingIds,
  onToggleSource, onAddSource, onRemoveSource,
}: {
  sources: SourcesByNetwork;
  hiddenIds: Set<string>;
  focusNetwork?: Network | null;
  scrapingIds: Set<string>;
  onToggleSource: (key: string) => void;
  onAddSource: (network: Network, name: string, scrapeQuery: string) => Promise<void>;
  onRemoveSource: (network: Network, sourceId: string) => void;
}) {
  const [isPanelExpanded, setIsPanelExpanded] = useState<boolean>(loadFilterExpanded);
  const [networkExpanded, setNetworkExpanded] =
    useState<Record<Network, boolean>>(loadNetworkExpanded);
  const [panelHeaderHovered, setPanelHeaderHovered] = useState(false);
  const [hoveredNetworkHeader, setHoveredNetworkHeader] = useState<Network | null>(null);

  const fbInputRef = useRef<HTMLInputElement | null>(null);
  const igInputRef = useRef<HTMLInputElement | null>(null);
  const ytInputRef = useRef<HTMLInputElement | null>(null);
  const fbSectionRef = useRef<HTMLDivElement | null>(null);
  const igSectionRef = useRef<HTMLDivElement | null>(null);
  const ytSectionRef = useRef<HTMLDivElement | null>(null);

  const inputRefByNetwork: Record<Network, React.RefObject<HTMLInputElement | null>> = {
    Facebook: fbInputRef,
    Instagram: igInputRef,
    YouTube: ytInputRef,
  };
  const sectionRefByNetwork: Record<Network, React.RefObject<HTMLDivElement | null>> = {
    Facebook: fbSectionRef,
    Instagram: igSectionRef,
    YouTube: ytSectionRef,
  };

  // Persist states
  useEffect(() => {
    saveFilterExpanded(isPanelExpanded);
  }, [isPanelExpanded]);

  useEffect(() => {
    saveNetworkExpanded(networkExpanded);
  }, [networkExpanded]);

  // Auto-otvor panel + príslušnú sieť pri focusNetwork (klik na sieť v StatusBar)
  useEffect(() => {
    if (!focusNetwork) return;
    const panelWasExpanded = isPanelExpanded;
    const networkWasExpanded = networkExpanded[focusNetwork];

    if (!panelWasExpanded) setIsPanelExpanded(true);
    if (!networkWasExpanded) {
      setNetworkExpanded((prev) => ({ ...prev, [focusNetwork]: true }));
    }

    // Počkaj na animácie pred scroll + focus
    const panelDelay = panelWasExpanded ? 0 : 320;
    const networkDelay = networkWasExpanded ? 0 : 280;
    const totalDelay = panelDelay + networkDelay;

    const timer = setTimeout(() => {
      sectionRefByNetwork[focusNetwork].current?.scrollIntoView({
        behavior: "smooth", block: "center",
      });
      setTimeout(() => {
        inputRefByNetwork[focusNetwork].current?.focus();
      }, 350);
    }, totalDelay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNetwork]);

  const counts = useMemo(() => ({
    Facebook: sources.facebook.length,
    Instagram: sources.instagram.length,
    YouTube: sources.youtube.length,
    total: sources.facebook.length + sources.instagram.length + sources.youtube.length,
  }), [sources]);

  const toggleNetwork = (network: Network) => {
    setNetworkExpanded((prev) => ({ ...prev, [network]: !prev[network] }));
  };

  return (
    <div style={{
      background: "#ffffff",
      border: "0.5px solid rgba(0,0,0,0.08)",
      borderRadius: 12,
      marginBottom: 14,
      overflow: "hidden",
    }}>
      {/* PANEL HEADER — vždy viditeľný, klikateľný */}
      <button
        type="button"
        onClick={() => setIsPanelExpanded((e) => !e)}
        onMouseEnter={() => setPanelHeaderHovered(true)}
        onMouseLeave={() => setPanelHeaderHovered(false)}
        aria-expanded={isPanelExpanded}
        aria-controls="filter-panel-body"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          width: "100%",
          padding: "14px 20px",
          background: panelHeaderHovered ? "#fafafa" : "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          transition: "background 160ms ease",
        }}
        title={isPanelExpanded ? "Zbaliť zoznam zdrojov" : "Rozbaliť zoznam zdrojov"}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{
            fontSize: 15,
            fontWeight: 500,
            color: "#1d1d1f",
            letterSpacing: "-0.1px",
          }}>
            Zdroje
          </span>
          <span style={{
            fontSize: 12,
            color: "#86868b",
            fontWeight: 400,
          }}>
            {counts.total === 0
              ? "Žiadne pridané"
              : `${counts.Facebook} Facebook · ${counts.Instagram} Instagram · ${counts.YouTube} YouTube`}
          </span>
        </div>
        <ChevronIcon expanded={isPanelExpanded} />
      </button>

      {/* PANEL BODY — collapsible cez grid-template-rows trick */}
      <div
        id="filter-panel-body"
        aria-hidden={!isPanelExpanded}
        style={{
          display: "grid",
          gridTemplateRows: isPanelExpanded ? "1fr" : "0fr",
          transition: "grid-template-rows 280ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{
            borderTop: "0.5px solid rgba(0,0,0,0.06)",
          }}>
            {NETWORK_KEYS.map(({ key, network }, idx) => {
              const list = sources[key];
              const isLast = idx === NETWORK_KEYS.length - 1;
              const isNetExpanded = networkExpanded[network];
              const isHovered = hoveredNetworkHeader === network;

              return (
                <div
                  key={network}
                  ref={sectionRefByNetwork[network]}
                  style={{
                    borderBottom: isLast ? "none" : "0.5px solid rgba(0,0,0,0.06)",
                  }}
                >
                  {/* NETWORK HEADER */}
                  <button
                    type="button"
                    onClick={() => toggleNetwork(network)}
                    onMouseEnter={() => setHoveredNetworkHeader(network)}
                    onMouseLeave={() => setHoveredNetworkHeader(null)}
                    aria-expanded={isNetExpanded}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      width: "100%",
                      padding: "12px 20px",
                      background: isHovered ? "#fafafa" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      transition: "background 160ms ease",
                    }}
                    title={isNetExpanded ? `Zbaliť ${network}` : `Rozbaliť ${network}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 15,
                        fontWeight: 500,
                        color: "#1d1d1f",
                      }}>
                        {network}
                      </span>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: list.length === 0 ? "#c7c7cc" : "#86868b",
                        padding: "1px 8px",
                        background: list.length === 0 ? "transparent" : "#f5f5f7",
                        borderRadius: 10,
                        minWidth: 22,
                        textAlign: "center",
                      }}>
                        {list.length}
                      </span>
                    </div>
                    <ChevronIcon expanded={isNetExpanded} size={16} />
                  </button>

                  {/* NETWORK BODY — collapsible */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateRows: isNetExpanded ? "1fr" : "0fr",
                      transition: "grid-template-rows 260ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                    }}
                    aria-hidden={!isNetExpanded}
                  >
                    <div style={{ overflow: "hidden", minHeight: 0 }}>
                      <div style={{ padding: "0 20px 14px" }}>
                        <AddSourceForm
                          network={network}
                          inputRef={inputRefByNetwork[network]}
                          onAdd={(name, scrapeQuery) => onAddSource(network, name, scrapeQuery)}
                        />

                        {list.length === 0 ? (
                          <div style={{
                            fontSize: 13,
                            color: "#c7c7cc",
                            padding: "6px 0",
                            fontStyle: "italic",
                          }}>
                            žiadne zdroje
                          </div>
                        ) : (
                          list.map((s) => {
                            const k = sourceKey(network, s.id);
                            const enabled = !hiddenIds.has(k);
                            return (
                              <SourceRow
                                key={s.id}
                                source={s}
                                enabled={enabled}
                                isScraping={scrapingIds.has(s.id)}
                                onToggle={() => onToggleSource(k)}
                                onRemove={() => onRemoveSource(network, s.id)}
                              />
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Status bar
// ============================================================

function StatusBar({
  status, sourceCounts, onRefresh, refreshing,
  mode, onToggleMode, onClickNetwork,
  loginStatus,
}: {
  status: Record<Network, NetworkStatus>;
  sourceCounts: Record<Network, number>;
  onRefresh: () => void;
  refreshing: boolean;
  mode: Mode;
  onToggleMode: () => void;
  onClickNetwork: (n: Network) => void;
  loginStatus: Record<Network, boolean>;
}) {
  const isFilter = mode === "filter";
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "11px 16px",
      background: "#ffffff",
      border: "0.5px solid rgba(0,0,0,0.08)",
      borderRadius: 10,
      fontSize: 13,
      color: "#86868b",
      marginBottom: 14,
      flexWrap: "wrap",
    }}>
      <span style={{ color: "#1d1d1f", fontWeight: 500 }}>Zdroje</span>
      {(["Facebook", "Instagram", "YouTube"] as Network[]).map((n) => {
        const s = status[n];
        const hasSources = sourceCounts[n] > 0;
        const isLoggedIn = loginStatus[n];
        const dotColor = isFilter
          ? (!hasSources
              ? "#d2d2d7"
              : s === "connected" ? "#34c759"
              : s === "error" ? "#ff3b30"
              : "#d2d2d7")
          : (isLoggedIn ? "#34c759" : "#d2d2d7");
        const labelColor = isFilter
          ? (hasSources ? "#1d1d1f" : "#c7c7cc")
          : (isLoggedIn ? "#1d1d1f" : "#c7c7cc");
        return (
          <button
            key={n}
            onClick={() => onClickNetwork(n)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: labelColor,
              fontSize: 13,
            }}
            title={isFilter
              ? (hasSources ? `${sourceCounts[n]} zdrojov — klik pre filter` : `Pridať ${n} zdroje`)
              : `Otvoriť ${n} v zen móde`}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: dotColor, display: "inline-block",
            }}/>
            {n}
          </button>
        );
      })}
      <span style={{ flex: 1 }} />
      <button
        onClick={onToggleMode}
        title={isFilter ? "Vypnúť filter — späť do free mode" : "Zapnúť filter — len vybrané profily"}
        style={{
          background: "transparent",
          border: "0.5px solid rgba(0,0,0,0.12)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 12px",
          borderRadius: 7,
          letterSpacing: "0.3px",
          color: isFilter ? "transparent" : "#86868b",
          backgroundImage: isFilter ? BRAND_GRADIENT : undefined,
          WebkitBackgroundClip: isFilter ? "text" : undefined,
          backgroundClip: isFilter ? "text" : undefined,
          transition: "color 200ms ease, background 200ms ease",
        }}
      >
        Filter
      </button>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        style={{
          background: "transparent",
          border: "none",
          color: refreshing ? "#c7c7cc" : "#0071e3",
          cursor: refreshing ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
        }}
      >
        {refreshing ? "Obnovuje sa…" : "Obnoviť"}
      </button>
    </div>
  );
}
// ============================================================
// Post card
// ============================================================

function PostCard({ post }: { post: Post }) {
  const [imageError, setImageError] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [videoEmbedded, setVideoEmbedded] = useState(false);

  const showImage = post.imageUrl && !imageError && isLikelyValidImage(post.imageUrl);
  const showVideoThumb =
    post.videoThumbUrl && !imageError && isLikelyValidImage(post.videoThumbUrl);

  // YouTube embed support: extract video ID z permalinku ak je to YT post
  const youtubeVideoId = post.network === "YouTube"
    ? extractYouTubeVideoId(post.permalink)
    : null;
  const canEmbedYouTube = !!youtubeVideoId && showVideoThumb;

  // Klik na celú kartu otvorí permalink, OKREM YT prípadu kde:
  // - video embed → klik na video sa rieši samostatne (prepne na embed)
  // - klik mimo videa stále otvorí YouTube
  // Embedded iframe samotný má pointer-events: auto a stopPropagation aby
  // kliky vnútri prehrávača (play/pause/seek) nešli na článok.
  const handleCardClick = () => {
    if (post.permalink) openExternal(post.permalink);
  };

  const handleThumbnailClick = (e: React.MouseEvent) => {
    if (canEmbedYouTube) {
      e.stopPropagation();
      setVideoEmbedded(true);
    }
    // Pre FB/IG s thumbnailom → propaguj klik na článok, otvorí permalink
  };

  const handleOpenYouTube = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (post.permalink) openExternal(post.permalink);
  };

  return (
    <article
      onClick={handleCardClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#ffffff",
        border: "0.5px solid rgba(0,0,0,0.08)",
        borderRadius: 12,
        padding: "18px 20px",
        cursor: post.permalink ? "pointer" : "default",
        transition: "transform 180ms ease, box-shadow 180ms ease",
        transform: hovered && !videoEmbedded ? "translateY(-1px)" : "none",
        boxShadow: hovered && !videoEmbedded ? "0 4px 14px rgba(0,0,0,0.06)" : "none",
      }}
    >
      <header style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
      }}>
        <Avatar name={post.sourceName} src={post.authorAvatar} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: "#1d1d1f", lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {post.sourceName}
          </div>
          <div style={{ fontSize: 13, color: "#86868b", marginTop: 1 }}>
            {formatRelativeTime(post.publishedAt)} · {post.network}
          </div>
        </div>
      </header>

      {post.body && (
        <p style={{
          fontFamily: 'Georgia, "IBM Plex Serif", "Charter", serif',
          fontSize: 16, lineHeight: 1.65, color: "#1d1d1f",
          margin: showImage || showVideoThumb ? "0 0 12px" : "0",
          fontWeight: 400,
          display: "-webkit-box",
          WebkitLineClamp: 6,
          WebkitBoxOrient: "vertical" as any,
          overflow: "hidden",
          wordBreak: "break-word",
        }}>
          {post.body}
        </p>
      )}

      {showImage && (
        <img
          src={post.imageUrl}
          alt=""
          onError={() => setImageError(true)}
          style={{
            width: "100%", maxHeight: 320, objectFit: "cover",
            borderRadius: 8, display: "block",
          }}
        />
      )}

      {/* YouTube embed mode: iframe player + "Otvoriť na YouTube" link */}
      {showVideoThumb && videoEmbedded && canEmbedYouTube && (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{
            position: "relative",
            paddingBottom: "56.25%", // 16:9 aspect ratio
            height: 0,
            overflow: "hidden",
            borderRadius: 8,
            background: "#000",
          }}>
            <iframe
              src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&rel=0`}
              title={post.body || "YouTube video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{
                position: "absolute",
                top: 0, left: 0,
                width: "100%", height: "100%",
                border: "none",
              }}
            />
          </div>
          <button
            onClick={handleOpenYouTube}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "6px 10px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 500,
              color: "#86868b",
              fontFamily: "inherit",
              borderRadius: 6,
              transition: "color 160ms ease, background 160ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#0071e3";
              e.currentTarget.style.background = "rgba(0,113,227,0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#86868b";
              e.currentTarget.style.background = "transparent";
            }}
            title="Otvoriť video v YouTube aplikácii alebo prehliadači"
          >
            Otvoriť na YouTube
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7"/>
              <polyline points="7 7 17 7 17 17"/>
            </svg>
          </button>
        </div>
      )}

      {/* Thumbnail mode (initial state pre videá) */}
      {showVideoThumb && !videoEmbedded && (
        <div
          onClick={handleThumbnailClick}
          style={{
            position: "relative",
            borderRadius: 8,
            overflow: "hidden",
            cursor: canEmbedYouTube ? "pointer" : (post.permalink ? "pointer" : "default"),
          }}
        >
          <img
            src={post.videoThumbUrl}
            alt=""
            onError={() => setImageError(true)}
            style={{
              width: "100%", maxHeight: 320, objectFit: "cover", display: "block",
            }}
          />
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 64, height: 64,
            background: canEmbedYouTube ? "#ff0000" : "rgba(0,0,0,0.55)",
            borderRadius: canEmbedYouTube ? 14 : "50%",
            display: "flex",
            alignItems: "center", justifyContent: "center",
            boxShadow: canEmbedYouTube ? "0 4px 16px rgba(0,0,0,0.35)" : "none",
            transition: "transform 180ms ease",
          }}>
            <div style={{
              width: 0, height: 0, borderStyle: "solid",
              borderWidth: "10px 0 10px 16px",
              borderColor: "transparent transparent transparent #ffffff",
              marginLeft: 4,
            }}/>
          </div>
        </div>
      )}
    </article>
  );
}

// ============================================================
// 7E: Cancel banner — informuje usera že predplatné je zrušené ale
// stále aktívne do konca obdobia. Klik na "Spravovať" otvorí Stripe
// Customer Portal kde môže predplatné obnoviť.
// ============================================================

function CancelBanner({
  endDate,
  tier,
  onManage,
}: {
  endDate: string;
  tier: string;
  onManage: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const formatted = formatPlanEndDate(endDate);
  if (!formatted) return null;

  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onManage();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 16px",
      background: "rgba(255, 149, 0, 0.06)",
      border: "0.5px solid rgba(255, 149, 0, 0.25)",
      borderRadius: 10,
      fontSize: 13,
      marginBottom: 14,
      flexWrap: "wrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: "#ff9500", display: "inline-block",
        flexShrink: 0,
      }}/>
      <span style={{ color: "#1d1d1f", fontWeight: 500 }}>
        {tierLabel} plán končí
      </span>
      <span style={{ color: "#86868b" }}>
        {formatted}
      </span>
      <span style={{ flex: 1 }} />
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          background: "transparent",
          border: "none",
          color: loading ? "#c7c7cc" : "#0071e3",
          cursor: loading ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          fontFamily: "inherit",
        }}
        title="Otvoriť Stripe Customer Portal pre obnovenie predplatného"
      >
        {loading ? "Otváram…" : "Obnoviť"}
      </button>
    </div>
  );
}

// ============================================================
// Master Feed View
// ============================================================

function MasterFeedView({
  sources, setSources, initialFocusNetwork, onBackToIndex,
  mode, setMode,
  billingStatus, billingLoaded,
  session, authLoaded, onOpenLogin, onLogout, onOpenPortal,
}: {
  sources: SourcesByNetwork;
  setSources: (s: SourcesByNetwork) => void;
  initialFocusNetwork?: Network | null;
  onBackToIndex: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  billingStatus: StatusResponse | null;
  billingLoaded: boolean;
  session: Session | null;
  authLoaded: boolean;
  onOpenLogin: (reason?: string) => void;
  onLogout: () => void;
  onOpenPortal: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [status, setStatus] = useState<Record<Network, NetworkStatus>>({
    Facebook: "empty", Instagram: "empty", YouTube: "empty",
  });
  const filterOpen = mode === "filter";
  const [focusNetwork, setFocusNetwork] = useState<Network | null>(
    initialFocusNetwork || null
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHidden);
  const [loginStatus] = useState<Record<Network, boolean>>({
    Facebook: false, Instagram: false, YouTube: false,
  });

  const [scrapedPosts, setScrapedPosts] = useState<Map<string, Post[]>>(new Map());
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set());

  const [upgradeModalNetwork, setUpgradeModalNetwork] = useState<Network | null>(null);

  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);

  useEffect(() => {
    const unlistenPromise = listen<{
      network: string;
      sourceId: string;
      posts: any[];
    }>("mf-scraped-posts", (event) => {
      const { network, sourceId, posts } = event.payload;
      const k = networkKey(network as Network);
      const sourcesNow = sourcesRef.current[k] || [];
      const matchingSource = sourcesNow.find((s) => s.id === sourceId);

      if (!matchingSource) {
        console.log(
          `[MF] Discarding late posts for removed source ${sourceId} (${network})`
        );
        return;
      }

      const sourceName = matchingSource.nazov;
      const incoming = Array.isArray(posts) ? posts : [];

      console.log(
        `[MF] Received ${incoming.length} post(s) for "${sourceName}" (${network}). ` +
        `Will display up to ${POSTS_PER_SOURCE}.`
      );

      const networkTyped = network as Network;
      const validPermalink = incoming.filter((p: any) => {
        if (!hasValidPermalink(p.permalink, networkTyped, matchingSource.nazov)) {
          console.log(
            `[MF] Dropping post for "${sourceName}" — invalid/missing permalink: ` +
            `"${(p.body || "").slice(0, 40)}…"`
          );
          return false;
        }
        return true;
      });

      const seenKeys = new Set<string>();
      const dedupedIncoming = validPermalink.filter((p: any) => {
        const body = (p.body || "").trim().toLowerCase();
        if (!body) return true;
        const key = body.slice(0, 80);
        if (seenKeys.has(key)) {
          console.log(`[MF] Dropping duplicate post for "${sourceName}": "${body.slice(0, 50)}…"`);
          return false;
        }
        seenKeys.add(key);
        return true;
      });

      const trimmed = dedupedIncoming.slice(0, POSTS_PER_SOURCE);

      const baseTime = Date.now();
      const mapped: Post[] = trimmed.map((p: any, idx: number) => ({
        id: `scrape-${sourceId}-${idx}-${p.id || baseTime}`,
        network: network as Network,
        sourceId,
        sourceName,
        body: p.body || "",
        imageUrl: p.imageUrl || undefined,
        videoThumbUrl: p.videoThumbUrl || undefined,
        permalink: p.permalink || "",
        publishedAt: p.publishedAt
          ? new Date(p.publishedAt)
          : new Date(baseTime - idx * 1000),
      }));

      setScrapedPosts((prev) => {
        const next = new Map(prev);
        next.set(sourceId, mapped);
        return next;
      });

      setScrapingIds((prev) => {
        if (!prev.has(sourceId)) return prev;
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    });

    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => { saveHidden(hiddenIds); }, [hiddenIds]);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (now - mfLastRefreshAt < REFRESH_DEBOUNCE_MS) {
      const ago = now - mfLastRefreshAt;
      console.log(`[MF] Refresh debounced — only ${ago}ms since last refresh.`);
      return;
    }
    mfLastRefreshAt = now;

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
      invoke("mf_scrape_profile", {
        network,
        profileName: source.scrapeQuery!,
        sourceId: source.id,
      }).catch((e) => {
        console.warn(`[MF] re-scrape "${source.nazov}" failed:`, e);
        setScrapingIds((prev) => {
          const next = new Set(prev);
          next.delete(source.id);
          return next;
        });
      });
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
  }, []);

  const manualRefresh = useCallback(() => {
    mfLastRefreshAt = 0;
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
        const limit = billingStatus.status.max_profiles_per_network;
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

      const newSource: SourceConfig = {
        id: generateId(),
        nazov: name,
        url: "",
        scrapeQuery,
      };
      const k = networkKey(network);
      const updated: SourcesByNetwork = {
        ...sourcesRef.current,
        [k]: [...sourcesRef.current[k], newSource],
      };
      setSources(updated);
      setStatus((prev) => ({ ...prev, [network]: "connected" }));

      setScrapingIds((prev) => new Set(prev).add(newSource.id));
      console.log(`[MF] Adding "${name}" (${network}) → triggering scrape...`);
      try {
        await invoke("mf_scrape_profile", {
          network,
          profileName: scrapeQuery,
          sourceId: newSource.id,
        });
      } catch (e) {
        console.error(`[MF] mf_scrape_profile failed for ${name}:`, e);
        setScrapingIds((prev) => {
          const next = new Set(prev);
          next.delete(newSource.id);
          return next;
        });
      }

      setTimeout(() => {
        setScrapingIds((prev) => {
          if (!prev.has(newSource.id)) return prev;
          const next = new Set(prev);
          next.delete(newSource.id);
          return next;
        });
      }, 30000);
    },
    [setSources, billingStatus, billingLoaded]
  );

  const removeSource = useCallback(
    (network: Network, sourceId: string) => {
      const k = networkKey(network);
      const updated: SourcesByNetwork = {
        ...sourcesRef.current,
        [k]: sourcesRef.current[k].filter((s) => s.id !== sourceId),
      };
      setSources(updated);
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
    [setSources]
  );

  const onClickNetwork = useCallback((n: Network) => {
    if (mode === "free") {
      openZenMode(n);
    } else {
      setFocusNetwork(null);
      setTimeout(() => setFocusNetwork(n), 0);
    }
  }, [mode]);

  const onToggleMode = useCallback(() => {
    const next: Mode = mode === "free" ? "filter" : "free";
    setMode(next);
  }, [mode, setMode]);

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

    const interleaved: Post[] = [];
    const maxLen = Math.max(...perSource.map((arr) => arr.length));
    for (let i = 0; i < maxLen; i++) {
      for (const arr of perSource) {
        if (i < arr.length) interleaved.push(arr[i]);
      }
    }
    return interleaved;
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
      onOpenLogin(
        `Pre upgrade na ${tier.display_name} sa najprv prihlás. ` +
        `Pošleme ti 6-miestny kód na e-mail.`
      );
      return;
    }

    try {
      const checkoutUrl = await invoke<string>("mf_create_checkout_session", {
        tierId: tier.tier_id,
        accessToken: session.access_token,
      });
      console.log(`[MF] Opening Stripe Checkout: ${checkoutUrl}`);
      await openExternal(checkoutUrl);
      setUpgradeModalNetwork(null);
    } catch (err: any) {
      console.error("[MF] Checkout session failed:", err);
      alert(
        `Nepodarilo sa otvoriť platbu.\n\n` +
        `Chyba: ${err?.message || err || "neznáma chyba"}\n\n` +
        `Skús prosím znova alebo nás kontaktuj.`
      );
    }
  }, [session, onOpenLogin]);

  return (
    <div style={{
      backgroundColor: "#f5f5f7",
      color: "#1d1d1f",
      minHeight: "100vh",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
              fontSize: 22, fontWeight: 500,
              letterSpacing: "-0.3px", color: "#1d1d1f",
            }}>
              Master feed
            </h1>
            <p style={{
              margin: 0, fontSize: 13, color: "#86868b", fontWeight: 400,
            }}>
              {isAnyScraping
                ? "Načítavam najnovšie posty…"
                : lastRefresh
                ? `Aktualizované ${formatRelativeTime(lastRefresh)}`
                : "Pripravené"}
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
                />
              ) : (
                <button
                  onClick={() => onOpenLogin()}
                  style={{
                    background: "transparent",
                    border: "0.5px solid rgba(0,0,0,0.12)",
                    color: "#0071e3",
                    cursor: "pointer",
                    fontSize: 12, fontWeight: 600,
                    padding: "5px 12px",
                    borderRadius: 7,
                    letterSpacing: "0.3px",
                    fontFamily: "inherit",
                  }}
                  title="Prihlásiť sa"
                >
                  Prihlásiť
                </button>
              )
            )}
            <button
              onClick={onBackToIndex}
              style={{
                background: "transparent", border: "none",
                color: "#86868b", cursor: "pointer",
                fontSize: 16, fontWeight: 500,
                padding: "4px 8px",
              }}
              title="Späť na úvod"
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
          mode={mode}
          onToggleMode={onToggleMode}
          onClickNetwork={onClickNetwork}
          loginStatus={loginStatus}
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

        {filterOpen && (
          <FilterPanel
            sources={sources}
            hiddenIds={hiddenIds}
            focusNetwork={focusNetwork}
            scrapingIds={scrapingIds}
            onToggleSource={toggleSource}
            onAddSource={addSource}
            onRemoveSource={removeSource}
          />
        )}

        {mode === "free" && (
          <div style={{
            textAlign: "center", padding: "40px 20px",
            color: "#86868b", fontSize: 14,
            background: "#ffffff", border: "0.5px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
          }}>
            Klikni na <strong>Facebook</strong>, <strong>Instagram</strong> alebo <strong>YouTube</strong> hore pre čistý feed danej platformy.
            <br /><br />
            <span style={{ fontSize: 12, color: "#c7c7cc" }}>
              Alebo zapni <strong>Filter</strong> pre kurátorovaný master feed z konkrétnych profilov.
            </span>
          </div>
        )}

        {mode === "filter" && totalSources === 0 && (
          <div style={{
            textAlign: "center", padding: "40px 20px",
            color: "#86868b", fontSize: 14,
            background: "#ffffff", border: "0.5px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
          }}>
            Žiadne zdroje vo filtri. Pridaj svoj prvý cez panel vyššie.
          </div>
        )}

        {mode === "filter" && totalSources > 0 && visiblePosts.length === 0 && !isAnyScraping && (
          <div style={{
            textAlign: "center", padding: "40px 20px",
            color: "#86868b", fontSize: 14,
          }}>
            Žiadne príspevky sa nepodarilo načítať.<br />
            Skontroluj mená profilov alebo skús Obnoviť.
          </div>
        )}

        {mode === "filter" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {visiblePosts.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>

            {visiblePosts.length > 0 && (
              <div style={{
                textAlign: "center", fontSize: 11,
                letterSpacing: "0.4px", color: "#c7c7cc",
                marginTop: 20, fontWeight: 500,
              }}>
                koniec feedu · ďalšie po obnove
              </div>
            )}
          </>
        )}
      </div>

      {upgradeModalNetwork && billingStatus && (
        <UpgradeModal
          currentTier={billingStatus.status.tier}
          currentLimit={billingStatus.status.max_profiles_per_network}
          network={upgradeModalNetwork}
          availableTiers={billingStatus.available_tiers}
          onClose={() => setUpgradeModalNetwork(null)}
          onPickTier={handlePickTier}
        />
      )}
    </div>
  );
}

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
      <>
        <IndexView onPickNetwork={handlePickNetwork} />
        {loginModalOpen && (
          <LoginModal
            reason={loginModalReason || undefined}
            onClose={() => setLoginModalReason(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
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
      />
      {loginModalOpen && (
        <LoginModal
          reason={loginModalReason || undefined}
          onClose={() => setLoginModalReason(null)}
        />
      )}
    </>
  );
}

export default App;