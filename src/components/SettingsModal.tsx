import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../lib/i18n";
import { useTheme } from "../lib/theme-context";
import type { Theme } from "../lib/theme";

const LANGUAGES: { code: string; label: string }[] = [
  { code: "sk", label: "Slovenčina" },
  { code: "en", label: "English" },
  { code: "cs", label: "Čeština" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "hu", label: "Magyar" },
  { code: "ro", label: "Română" },
  { code: "bg", label: "Български" },
  { code: "el", label: "Ελληνικά" },
  { code: "da", label: "Dansk" },
  { code: "sv", label: "Svenska" },
  { code: "fi", label: "Suomi" },
  { code: "et", label: "Eesti" },
  { code: "lv", label: "Latviešu" },
  { code: "lt", label: "Lietuvių" },
  { code: "sl", label: "Slovenščina" },
  { code: "hr", label: "Hrvatski" },
  { code: "mt", label: "Malti" },
  { code: "ga", label: "Gaeilge" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { theme, setTheme, colors: c } = useTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const currentLang = i18n.language?.split("-")[0] || "sk";

  const handleLangChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };

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
          {t("settings.title")}
        </h2>

        <section style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            color: c.muted,
            marginBottom: 12,
          }}>
            {t("settings.appearance")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["light", "dark", "system"] as Theme[]).map((themeVal) => (
              <ThemeOption
                key={themeVal}
                value={themeVal}
                active={theme === themeVal}
                onSelect={() => setTheme(themeVal)}
              />
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            color: c.muted,
            marginBottom: 12,
          }}>
            {t("settings.language")}
          </div>
          <select
            value={currentLang}
            onChange={handleLangChange}
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
              cursor: "pointer",
            }}
          >
            {LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
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
          {t("settings.close")}
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
  const { t } = useTranslation();
  const { colors: c } = useTheme();

  const label = value === "light"
    ? t("settings.themeLight")
    : value === "dark"
    ? t("settings.themeDark")
    : t("settings.themeSystem");

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
