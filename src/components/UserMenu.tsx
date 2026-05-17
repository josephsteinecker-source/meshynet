import { useState, useRef, useEffect } from "react";
import { BRAND_GRADIENT } from "../types";

export function UserMenu({
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
