import type { Network, NetworkStatus, Mode } from "../types";
import { BRAND_GRADIENT } from "../lib/theme";
import { useTheme } from "../lib/theme-context";

export function StatusBar({
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
  const { colors: c } = useTheme();
  const isFilter = mode === "filter";
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
      <span style={{ color: c.fg, fontWeight: 500 }}>Zdroje</span>
      {(["Facebook", "Instagram", "YouTube"] as Network[]).map((n) => {
        const s = status[n];
        const hasSources = sourceCounts[n] > 0;
        const isLoggedIn = loginStatus[n];
        const dotColor = isFilter
          ? (!hasSources
              ? c.border
              : s === "connected" ? c.online
              : s === "error" ? c.danger
              : c.border)
          : (isLoggedIn ? c.online : c.border);
        const labelColor = isFilter
          ? (hasSources ? c.fg : c.muted)
          : (isLoggedIn ? c.fg : c.muted);
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
          border: `0.5px solid ${c.border}`,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 12px",
          borderRadius: 7,
          letterSpacing: "0.3px",
          color: isFilter ? "transparent" : c.muted,
          backgroundImage: isFilter ? BRAND_GRADIENT.cssString : undefined,
          WebkitBackgroundClip: isFilter ? "text" : undefined,
          backgroundClip: isFilter ? "text" : undefined,
          transition: "color 200ms ease, background 200ms ease",
          fontFamily: "inherit",
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
          color: refreshing ? c.muted : c.accent,
          cursor: refreshing ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          fontFamily: "inherit",
        }}
      >
        {refreshing ? "Obnovuje sa…" : "Obnoviť"}
      </button>
    </div>
  );
}
