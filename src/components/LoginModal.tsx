// ============================================================
// 7D: Login Modal — OTP kód email auth (Tauri-compatible)
//
// Magic link nefunguje v Tauri appkách: link sa otvorí v default browseri,
// kde sa session uloží do localStorage browsera. Tauri webview má svoj
// vlastný izolovaný localStorage a tú session nevidí. Riešenie: OTP kód
// (6 čísel). User dostane kód v emaily, zadá ho priamo v Tauri appke,
// Supabase vráti session — všetko bez redirectu, bez browsera.
// ============================================================

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme-context";

type LoginStage = "email" | "sending_email" | "code" | "verifying" | "error";

export function LoginModal({
  reason,
  onClose,
}: {
  reason?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors: c } = useTheme();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<LoginStage>("email");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValidCode = /^\d{6,10}$/.test(code.trim());

  // Krok 1: pošli OTP kód na email
  const handleSendCode = async () => {
    if (!isValidEmail || stage === "sending_email") return;
    setStage("sending_email");
    setErrorMsg("");
    try {
      // shouldCreateUser: true → ak user neexistuje, vytvorí sa.
      // Trigger handle_new_user v DB automaticky vytvorí user_profile s tier='free'.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) {
        console.error("[MF] OTP send failed:", error);
        setErrorMsg(error.message || t("login.errorSendFailed"));
        setStage("error");
        return;
      }
      console.log("[MF] OTP code sent to:", email);
      setStage("code");
    } catch (err: any) {
      console.error("[MF] OTP send unexpected error:", err);
      setErrorMsg(err?.message || t("login.errorUnexpected"));
      setStage("error");
    }
  };

  // Krok 2: over OTP kód → Supabase vráti session (uloží sa do Tauri localStorage)
  const handleVerifyCode = async () => {
    if (!isValidCode || stage === "verifying") return;
    setStage("verifying");
    setErrorMsg("");
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: "email",
      });
      if (error) {
        console.error("[MF] OTP verify failed:", error);
        setErrorMsg(
          /invalid|expired/i.test(error.message)
            ? t("login.errorInvalidCode")
            : error.message || t("login.errorVerifyFailed")
        );
        setStage("error");
        return;
      }
      console.log("[MF] OTP verified, user:", data.user?.email);
      // onAuthStateChange v App komponente automaticky updatne session state,
      // modal sa zavrie a UI prejde do prihláseného stavu.
      onClose();
    } catch (err: any) {
      console.error("[MF] OTP verify unexpected error:", err);
      setErrorMsg(err?.message || t("login.errorUnexpected"));
      setStage("error");
    }
  };

  const showEmailStage = stage === "email" || stage === "sending_email"
    || (stage === "error" && !code);
  const showCodeStage = stage === "code" || stage === "verifying"
    || (stage === "error" && code);

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
          maxWidth: 400,
          width: "100%",
          boxShadow: c.shadow,
          border: `0.5px solid ${c.border}`,
          animation: "mf-slidein 220ms ease",
          fontFamily: "'Manrope', sans-serif",
        }}
      >
        {showEmailStage && (
          // Krok 1: zadaj email
          <>
            <h2
              style={{
                margin: "0 0 6px",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.3px",
                color: c.fg,
                textAlign: "center",
              }}
            >
              {t("login.title")}
            </h2>
            <p
              style={{
                margin: "0 0 24px",
                fontSize: 13,
                color: c.muted,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {reason || t("login.defaultReason")}
            </p>

            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (stage === "error") setStage("email");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidEmail) handleSendCode();
              }}
              placeholder={t("login.emailPlaceholder")}
              autoFocus
              disabled={stage === "sending_email"}
              style={{
                width: "100%",
                padding: "12px 14px",
                background: c.inputBg,
                border: stage === "error"
                  ? `0.5px solid ${c.danger}`
                  : `0.5px solid ${c.inputBorder}`,
                borderRadius: 10,
                fontSize: 14,
                color: c.fg,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />

            {stage === "error" && (
              <div
                style={{
                  fontSize: 12,
                  color: c.danger,
                  marginBottom: 12,
                  paddingLeft: 4,
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleSendCode}
              disabled={!isValidEmail || stage === "sending_email"}
              style={{
                width: "100%",
                background: isValidEmail && stage !== "sending_email" ? c.accent : c.border,
                border: "none",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                padding: "12px 0",
                cursor: isValidEmail && stage !== "sending_email" ? "pointer" : "default",
                borderRadius: 10,
                fontFamily: "inherit",
                marginBottom: 8,
                transition: "background 160ms ease",
              }}
            >
              {stage === "sending_email" ? t("login.sendingCode") : t("login.sendCode")}
            </button>

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
              {t("login.maybeLater")}
            </button>
          </>
        )}

        {showCodeStage && (
          // Krok 2: zadaj 6-miestny kód
          <>
            <h2
              style={{
                margin: "0 0 6px",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.3px",
                color: c.fg,
                textAlign: "center",
              }}
            >
              {t("login.step2Title")}
            </h2>
            <p
              style={{
                margin: "0 0 24px",
                fontSize: 13,
                color: c.muted,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {t("login.codeSentTo", { email })}
            </p>

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/\D/g, "").slice(0, 10);
                setCode(cleaned);
                if (stage === "error") setStage("code");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidCode) handleVerifyCode();
              }}
              placeholder="123456"
              autoFocus
              disabled={stage === "verifying"}
              style={{
                width: "100%",
                padding: "14px 14px",
                background: c.inputBg,
                border: stage === "error"
                  ? `0.5px solid ${c.danger}`
                  : `0.5px solid ${c.inputBorder}`,
                borderRadius: 10,
                fontSize: 22,
                fontWeight: 600,
                color: c.fg,
                fontFamily: '"SF Mono", "Menlo", monospace',
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
                letterSpacing: "8px",
                textAlign: "center",
              }}
            />

            {stage === "error" && (
              <div
                style={{
                  fontSize: 12,
                  color: c.danger,
                  marginBottom: 12,
                  paddingLeft: 4,
                  textAlign: "center",
                }}
              >
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleVerifyCode}
              disabled={!isValidCode || stage === "verifying"}
              style={{
                width: "100%",
                background: isValidCode && stage !== "verifying" ? c.accent : c.border,
                border: "none",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                padding: "12px 0",
                cursor: isValidCode && stage !== "verifying" ? "pointer" : "default",
                borderRadius: 10,
                fontFamily: "inherit",
                marginBottom: 8,
                transition: "background 160ms ease",
              }}
            >
              {stage === "verifying" ? t("login.verifying") : t("login.verify")}
            </button>

            <button
              onClick={() => {
                setCode("");
                setErrorMsg("");
                setStage("email");
              }}
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
              {t("login.useOtherEmail")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
