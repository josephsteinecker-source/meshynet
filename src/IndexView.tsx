import { useState } from "react";
import type { Network } from "./types";
import { BRAND_GRADIENT } from "./types";

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

export function IndexView({ onPickNetwork }: { onPickNetwork: (n: Network) => void }) {
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
          e.currentTarget.style.display = "none";
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
