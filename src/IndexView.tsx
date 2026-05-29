import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BRAND_GRADIENT } from "./lib/theme";
import { useTheme } from "./lib/theme-context";

function EnterButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 340,
        padding: "15px 32px",
        borderRadius: 999,
        background: BRAND_GRADIENT.cssString,
        color: "#ffffff",
        border: "none",
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        fontFamily: "'Manrope', sans-serif",
        boxShadow: hovered
          ? "0 10px 32px rgba(47, 190, 190, 0.4)"
          : "0 6px 24px rgba(47, 190, 190, 0.25)",
        transform: hovered ? "translateY(-1px)" : "none",
        transition: "transform 0.2s, box-shadow 0.2s, filter 0.2s",
        filter: hovered ? "brightness(1.08)" : "none",
      }}
    >
      {t("auth.registerOrLogin")}
    </button>
  );
}

export function IndexView({ onEnter }: { onEnter: () => void }) {
  const { t } = useTranslation();
  const { colors: c, isDark } = useTheme();
  return (
    <div style={{
      backgroundColor: c.bg,
      color: c.fg,
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Manrope', sans-serif",
      padding: "40px 20px",
      position: "relative",
    }}>
      <img
        src={isDark ? "/MeshyNet_logo_darkk_mode.svg" : "/MeshyNet_logo.svg"}
        alt="MeshyNet"
        style={{ width: 120, height: "auto", marginBottom: 32 }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />

      <h1 style={{
        margin: "0 0 14px",
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: 1.1,
        color: c.fg,
        fontFamily: "'Manrope', sans-serif",
      }}>
        Master{" "}
        <span style={{
          fontFamily: "'Fraunces', Georgia, serif",
          fontStyle: "italic",
          fontWeight: 600,
          background: BRAND_GRADIENT.cssString,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}>
          feed
        </span>
      </h1>

      <p style={{
        margin: "0 0 48px",
        color: c.muted,
        fontSize: 15,
        fontWeight: 400,
        textAlign: "center",
        maxWidth: 380,
        lineHeight: 1.5,
        fontFamily: "'Manrope', sans-serif",
      }}>
        {t("index.subtitle1")}
        <br />{t("index.subtitle2")}
      </p>

      <EnterButton onClick={onEnter} />
    </div>
  );
}
