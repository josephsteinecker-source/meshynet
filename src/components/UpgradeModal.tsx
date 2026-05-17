import { useState, useEffect, useMemo } from "react";
import type { Network, PricingTier } from "../types";
import { useTheme } from "../lib/theme-context";

export function UpgradeModal({
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
  const { colors: c } = useTheme();
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
        background: "rgba(0,0,0,0.6)",
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
          background: c.bgElevated,
          borderRadius: 20,
          padding: "32px 28px 24px",
          maxWidth: 400,
          width: "100%",
          boxShadow: c.shadow,
          border: `0.5px solid ${c.border}`,
          animation: "mf-slidein 220ms ease",
          fontFamily: "'Manrope', sans-serif",
        }}
      >
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.3px",
            color: c.fg,
            textAlign: "center",
          }}
        >
          Maximum profilov dosiahnuté
        </h2>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 13,
            color: c.muted,
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
                color: c.muted,
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
            color: c.muted,
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
  const { colors: c } = useTheme();
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
        background: hovered ? c.bgHover : c.bgElevated,
        border: `0.5px solid ${c.borderStrong}`,
        borderRadius: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 160ms ease, border-color 160ms ease",
      }}
    >
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: c.fg }}>
          {tier.display_name}
        </div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
          {tier.max_profiles_per_network} profilov per sieť
        </div>
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: c.accent,
          whiteSpace: "nowrap",
        }}
      >
        {priceLabel}
      </div>
    </button>
  );
}
