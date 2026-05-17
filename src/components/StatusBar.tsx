import { useTranslation } from "react-i18next";
import type { Network, NetworkStatus } from "../types";
import { useTheme } from "../lib/theme-context";

export function StatusBar({
  status, sourceCounts, onRefresh, refreshing, onClickNetwork,
}: {
  status: Record<Network, NetworkStatus>;
  sourceCounts: Record<Network, number>;
  onRefresh: () => void;
  refreshing: boolean;
  onClickNetwork: (n: Network) => void;
}) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "11px 16px",
      background: c.bgElevated,
      border: `0.5px solid ${c.border}`,
      borderRadius: 10,
      fontSize: 13,
      color: c.muted,
      marginBottom: 14,
      flexWrap: "wrap",
      fontFamily: "'Manrope', sans-serif",
    }}>
      <span style={{ color: c.fg, fontWeight: 500 }}>{t("statusBar.sources")}</span>
      {(["Facebook", "Instagram", "YouTube"] as Network[]).map((n) => {
        const s = status[n];
        const hasSources = sourceCounts[n] > 0;
        const dotColor = !hasSources
          ? c.border
          : s === "connected" ? c.online
          : s === "error" ? c.danger
          : c.border;
        const labelColor = hasSources ? c.fg : c.muted;
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
              fontFamily: "inherit",
            }}
            title={hasSources
              ? t("statusBar.sourcesWithCount", { count: sourceCounts[n] })
              : t("statusBar.addNetwork", { network: n })}
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
        onClick={onRefresh}
        disabled={refreshing}
        style={{
          background: "transparent",
          border: "none",
          color: refreshing ? c.muted : c.accent,
          cursor: refreshing ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        {refreshing ? t("statusBar.refreshing") : t("statusBar.refresh")}
      </button>
    </div>
  );
}
