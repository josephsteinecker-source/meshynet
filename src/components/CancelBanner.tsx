import { useState } from "react";
import { formatPlanEndDate } from "../lib/format";

export function CancelBanner({
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
