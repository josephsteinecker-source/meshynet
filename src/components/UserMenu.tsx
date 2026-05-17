import { useState, useRef, useEffect } from "react";
import { BRAND_GRADIENT } from "../lib/theme";
import { useTheme } from "../lib/theme-context";

export function UserMenu({
  email,
  tier,
  onLogout,
  onOpenPortal,
  onOpenSettings,
}: {
  email: string;
  tier: string;
  onLogout: () => void;
  onOpenPortal: () => Promise<void> | void;
  onOpenSettings: () => void;
}) {
  const { colors: c } = useTheme();
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
          background: BRAND_GRADIENT.cssString,
          color: "#ffffff",
          border: "none",
          cursor: "pointer",
          fontSize: 12, fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Manrope', sans-serif",
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
            background: c.bgElevated,
            border: `0.5px solid ${c.border}`,
            borderRadius: 10,
            boxShadow: c.shadow,
            minWidth: 220,
            padding: "8px 0",
            zIndex: 1000,
            fontFamily: "'Manrope', sans-serif",
          }}
        >
          {/* Email + tier badge */}
          <div
            style={{
              padding: "4px 14px 10px",
              borderBottom: `0.5px solid ${c.border}`,
            }}
          >
            <div style={{
              fontSize: 11,
              color: c.muted,
              wordBreak: "break-all",
              lineHeight: 1.4,
              marginBottom: 4,
            }}>
              {email}
            </div>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: isPaid ? "transparent" : c.muted,
              backgroundImage: isPaid ? BRAND_GRADIENT.cssString : undefined,
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
                color: portalLoading ? c.muted : c.fg,
                fontFamily: "inherit",
                cursor: portalLoading ? "default" : "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (!portalLoading) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {portalLoading ? "Otváram…" : "Spravovať predplatné"}
            </button>
          )}

          <button
            onClick={() => { setOpen(false); onOpenSettings(); }}
            style={{
              display: "block",
              width: "100%",
              background: "transparent",
              border: "none",
              padding: "10px 14px",
              fontSize: 13,
              color: c.fg,
              fontFamily: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Nastavenia
          </button>

          <button
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              display: "block",
              width: "100%",
              background: "transparent",
              border: "none",
              padding: "10px 14px",
              fontSize: 13,
              color: c.fg,
              fontFamily: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Odhlásiť sa
          </button>
        </div>
      )}
    </div>
  );
}
