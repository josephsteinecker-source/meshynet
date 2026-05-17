import type { Network, NetworkStatus, Mode } from "../types";
import { BRAND_GRADIENT } from "../types";

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
