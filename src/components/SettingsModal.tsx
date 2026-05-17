import { useEffect } from "react";
import { useTheme } from "../lib/theme-context";
import type { Theme } from "../lib/theme";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme, setTheme, colors: c } = useTheme();

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
        background: "rgba(0, 0, 0, 0.6)",
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
            margin: "0 0 24px",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: c.fg,
          }}
        >
          Nastavenia
        </h2>

        {/* Vzhľad */}
        <section style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            color: c.muted,
            marginBottom: 12,
          }}>
            Vzhľad
          </div>
          <div style={{
            display: "flex",
            gap: 8,
          }}>
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <ThemeOption
                key={t}
                value={t}
                active={theme === t}
                onSelect={() => setTheme(t)}
              />
            ))}
          </div>
        </section>

        {/* Jazyk */}
        <section style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            color: c.muted,
            marginBottom: 12,
          }}>
            Jazyk
          </div>
          <select
            disabled
            style={{
              width: "100%",
              padding: "10px 12px",
              background: c.inputBg,
              border: `0.5px solid ${c.inputBorder}`,
              borderRadius: 8,
              fontSize: 14,
              color: c.fg,
              fontFamily: "inherit",
              appearance: "none",
              cursor: "not-allowed",
              opacity: 0.6,
            }}
          >
            <option value="sk">🇸🇰 Slovenčina</option>
          </select>
          <div style={{
            fontSize: 12,
            color: c.muted,
            marginTop: 6,
            paddingLeft: 2,
          }}>
            Ďalšie jazyky prídu v ďalšej verzii.
          </div>
        </section>

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
          Zatvoriť
        </button>
      </div>
    </div>
  );
}

function ThemeOption({
  value,
  active,
  onSelect,
}: {
  value: Theme;
  active: boolean;
  onSelect: () => void;
}) {
  const { colors: c } = useTheme();

  const label = value === "light" ? "☀️ Svetlý" : value === "dark" ? "🌙 Tmavý" : "⚙️ Systém";

  return (
    <button
      onClick={onSelect}
      style={{
        flex: 1,
        padding: "10px 8px",
        borderRadius: 10,
        border: active ? `1.5px solid ${c.accent}` : `0.5px solid ${c.border}`,
        background: active ? `${c.accent}18` : c.inputBg,
        color: active ? c.accent : c.fg,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "border-color 160ms ease, background 160ms ease, color 160ms ease",
      }}
    >
      {label}
    </button>
  );
}
