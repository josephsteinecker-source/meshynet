import { useState } from "react";
import { formatPlanEndDate } from "../lib/format";
import { useTheme } from "../lib/theme-context";

export function CancelBanner({
  endDate,
  tier,
  onManage,
}: {
  endDate: string;
  tier: string;
  onManage: () => Promise<void>;
}) {
  const { colors: c, isDark } = useTheme();
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

  const warnColor = isDark ? "rgba(255, 159, 10, 0.06)" : "rgba(255, 149, 0, 0.06)";
  const warnBorder = isDark ? "rgba(255, 159, 10, 0.25)" : "rgba(255, 149, 0, 0.25)";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 16px",
      background: warnColor,
      border: `0.5px solid ${warnBorder}`,
      borderRadius: 10,
      fontSize: 13,
      marginBottom: 14,
      flexWrap: "wrap",
      fontFamily: "'Manrope', sans-serif",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: c.warning, display: "inline-block",
        flexShrink: 0,
      }}/>
      <span style={{ color: c.fg, fontWeight: 500 }}>
        {tierLabel} plán končí
      </span>
      <span style={{ color: c.muted }}>
        {formatted}
      </span>
      <span style={{ flex: 1 }} />
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          background: "transparent",
          border: "none",
          color: loading ? c.muted : c.accent,
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
