import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Network, PricingTier, Tier } from "../types";
import { BRAND_GRADIENT } from "../lib/theme";
import { useTheme } from "../lib/theme-context";

export function UpgradeModal({
  currentTier,
  network,
  availableTiers,
  onClose,
  onPickTier,
}: {
  currentTier: Tier;
  network: Network;
  availableTiers: PricingTier[];
  onClose: () => void;
  onPickTier: (tier: PricingTier) => void;
}) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const plusTier = availableTiers.find((tier) => tier.tier_id === "plus");
  const unlimitedTier = availableTiers.find((tier) => tier.tier_id === "unlimited");

  const showPlus = currentTier === "free" && !!plusTier;
  const showUnlimited = currentTier !== "unlimited" && !!unlimitedTier;

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
          maxWidth: 420,
          width: "100%",
          boxShadow: c.shadow,
          border: `0.5px solid ${c.border}`,
          animation: "mf-slidein 220ms ease",
          fontFamily: "'Manrope', sans-serif",
        }}
      >
        <h2 style={{
          margin: "0 0 6px",
          fontSize: 20, fontWeight: 600,
          letterSpacing: "-0.3px",
          color: c.fg, textAlign: "center",
        }}>
          {t("upgrade.title")}
        </h2>
        <p style={{
          margin: "0 0 24px",
          fontSize: 13, color: c.muted,
          textAlign: "center", lineHeight: 1.5,
        }}>
          {t("upgrade.subtitle", { network })}
        </p>

        <div style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          justifyContent: showPlus && showUnlimited ? "stretch" : "center",
        }}>
          {showPlus && plusTier && (
            <PlanCard t={t} tier={plusTier} onPick={() => onPickTier(plusTier)} flex />
          )}
          {showUnlimited && unlimitedTier && (
            <UnlimitedCard t={t} tier={unlimitedTier} onPick={() => onPickTier(unlimitedTier)} flex={showPlus} />
          )}
        </div>

        {!showPlus && !showUnlimited && (
          <div style={{ fontSize: 13, color: c.muted, textAlign: "center", padding: "20px 0" }}>
            {t("upgrade.noTiers")}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            color: c.muted,
            fontSize: 13, fontWeight: 500,
            padding: "10px 0",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("upgrade.maybeLater")}
        </button>
      </div>
    </div>
  );
}

function priceLabel(price: number, t: TFunction): string {
  return price === 0
    ? t("upgrade.free")
    : t("upgrade.perMonth", { price: price.toFixed(2).replace(".", ",") });
}

function limitLabel(limit: number, t: TFunction): string {
  return limit >= 9999
    ? t("upgrade.unlimited")
    : t("upgrade.limitLabel", { count: limit });
}

function PlanCard({ t, tier, onPick, flex }: { t: TFunction; tier: PricingTier; onPick: () => void; flex: boolean }) {
  const { colors: c } = useTheme();
  return (
    <div style={{
      flex: flex ? 1 : undefined,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      gap: 10,
      padding: "16px 14px",
      background: c.bg,
      border: `0.5px solid ${c.borderStrong}`,
      borderRadius: 13,
      minWidth: 140,
    }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: c.fg, marginBottom: 4 }}>
          {tier.display_name}
        </div>
        <div style={{ fontSize: 12, color: c.muted }}>
          {limitLabel(tier.max_profiles_per_platform, t)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: c.fg, marginBottom: 10 }}>
          {priceLabel(tier.price_eur, t)}
        </div>
        <button
          onClick={onPick}
          style={{
            width: "100%",
            padding: "9px 0",
            borderRadius: 8,
            background: "transparent",
            border: `0.5px solid ${c.borderStrong}`,
            color: c.fg,
            fontSize: 13, fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("upgrade.upgradeCta")}
        </button>
      </div>
    </div>
  );
}

function UnlimitedCard({ t, tier, onPick, flex }: { t: TFunction; tier: PricingTier; onPick: () => void; flex: boolean }) {
  const { colors: c } = useTheme();
  return (
    <div style={{
      flex: flex ? 1 : undefined,
      background: BRAND_GRADIENT.cssString,
      borderRadius: 14,
      padding: 1.5,
      minWidth: 140,
    }}>
      <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 10,
        padding: "15px 13px",
        background: c.bgElevated,
        borderRadius: 13,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: c.fg }}>
              {tier.display_name}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700,
              background: BRAND_GRADIENT.cssString,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              letterSpacing: "0.5px",
            }}>
              {t("upgrade.bestValue")}
            </span>
          </div>
          <div style={{ fontSize: 12, color: c.muted }}>
            {limitLabel(tier.max_profiles_per_platform, t)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: c.fg, marginBottom: 10 }}>
            {priceLabel(tier.price_eur, t)}
          </div>
          <button
            onClick={onPick}
            style={{
              width: "100%",
              padding: "9px 0",
              borderRadius: 8,
              background: BRAND_GRADIENT.cssString,
              border: "none",
              color: "#ffffff",
              fontSize: 13, fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("upgrade.upgradeCta")}
          </button>
        </div>
      </div>
    </div>
  );
}
