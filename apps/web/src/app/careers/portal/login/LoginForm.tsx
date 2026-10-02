"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

const GOV_BLUE = "#154089";
/** >= 4.5:1 on white (the old #94a3b8 hint/disabled colours were ~2.6:1). */
const MUTED = "#475569";
const DISABLED_BG = "#64748b";
/** Minimum gap between code sends from this form. The server TTL/attempt limits are unchanged. */
export const RESEND_COOLDOWN_SECONDS = 30;
const DEFAULT_EXPIRES_IN_SECONDS = 600;

/**
 * Application references are APP-YYYY-XXXXXX or APP-<8 hex> depending on which writer produced them.
 * Anything else in ?ref is ignored so a crafted link cannot put arbitrary text in the trusted banner.
 */
export const APPLICATION_REF_PATTERN = /^APP-[A-Z0-9-]{4,20}$/i;

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Field = "email" | "otp";
type ErrorKey = "sendFailed" | "invalidCode" | "locked" | "cooldown" | "noAccount" | "noChallenge" | "network" | "validation" | "generic";

/** Map an API error (status + code) to a localisable key; unknown failures keep the server message as fallback. */
export function errorKeyFor(status: number, code: string | undefined, phase: "send" | "verify"): ErrorKey {
  if (code === "MAX_ATTEMPTS" || (phase === "verify" && status === 429)) return "locked";
  if (code === "OTP_COOLDOWN" || (phase === "send" && status === 429)) return "cooldown";
  if (code === "OTP_INVALID") return "invalidCode";
  if (code === "NO_CHALLENGE") return "noChallenge";
  if (code === "NOT_FOUND" && phase === "verify") return "noAccount";
  if (code === "GATEWAY_ERROR" || status >= 500) return "network";
  if (code === "VALIDATION_FAILED") return "validation";
  return phase === "send" ? "sendFailed" : "invalidCode";
}

function LoginSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ maxWidth: 420, margin: "0 auto", padding: "0 16px" }}>
      <div style={{ background: GOV_BLUE, borderRadius: 12, height: 108, marginBottom: 20, opacity: 0.85 }} />
      <div style={{ background: "#e2e8f0", borderRadius: 9, height: 44, marginBottom: 14 }} />
      <div style={{ background: "#e2e8f0", borderRadius: 10, height: 48 }} />
    </div>
  );
}

function LoginFormInner() {
  const t = useTranslations("careersPortalLogin");
  const router = useRouter();
  const params = useSearchParams();
  const rawRef = params.get("ref") ?? "";
  const ref = APPLICATION_REF_PATTERN.test(rawRef) ? rawRef : "";

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"email" | "otp">("email");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<Field | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const emailRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== "otp") return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [phase]);

  // Move focus to the offending field so keyboard / screen-reader users land on the error.
  useEffect(() => {
    if (status !== "error" || !errorField) return;
    (errorField === "email" ? emailRef : otpRef).current?.focus();
  }, [status, errorField, error]);

  const expired = phase === "otp" && now >= expiresAt;
  const resendWait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function fail(field: Field, key: ErrorKey, serverMessage?: string) {
    setStatus("error");
    setErrorField(field);
    // Known codes are localised; only an unrecognised failure falls back to the server text.
    setError(key === "generic" && serverMessage ? serverMessage : t(`error_${key}`));
  }

  async function sendCode() {
    if (!email.trim()) return;
    setStatus("loading");
    setError("");
    setErrorField(null);
    try {
      const res = await fetch("/api/careers/auth/otp-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { code?: string; message?: string };
        fail("email", errorKeyFor(res.status, d.code, "send"));
        return;
      }
      const data = await res.json() as { devCode?: string; expiresIn?: number };
      const sentAt = Date.now();
      setOtp(data.devCode ?? "");
      setNow(sentAt);
      setExpiresAt(sentAt + (typeof data.expiresIn === "number" ? data.expiresIn : DEFAULT_EXPIRES_IN_SECONDS) * 1000);
      setResendAt(sentAt + RESEND_COOLDOWN_SECONDS * 1000);
      setLocked(false);
      setPhase("otp");
      setStatus("idle");
    } catch {
      fail("email", "network");
    }
  }

  function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    void sendCode();
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return;
    setStatus("loading");
    setError("");
    setErrorField(null);
    try {
      const res = await fetch("/api/careers/auth/otp-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { code?: string; message?: string };
        const key = errorKeyFor(res.status, d.code, "verify");
        if (key === "locked") setLocked(true);
        fail("otp", key);
        return;
      }
      router.push(ref ? `/careers/portal?ref=${encodeURIComponent(ref)}` : "/careers/portal");
    } catch {
      fail("otp", "network");
    }
  }

  const emailInvalid = status === "error" && errorField === "email";
  const otpInvalid = status === "error" && errorField === "otp";
  const errorBox = (id: string) => (
    <p id={id} role="alert" style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 13 }}>{error}</p>
  );
  const verifyDisabled = status === "loading" || otp.length !== 6 || expired || locked;

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "0 16px" }}>
      {/* Header. No sovereign/org claim here: the tenant is not necessarily the Government of India. */}
      <div style={{ background: GOV_BLUE, borderRadius: 12, padding: "24px 24px 20px", marginBottom: 20, color: "#fff", textAlign: "center" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800 }}>{t("title")}</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#bfdbfe" }}>{t("subtitle")}</p>
      </div>

      {ref && (
        <div style={{ background: "#cffafe", border: "1px solid #a5f3fc", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#0e7490" }}>
          <span aria-hidden="true">📋 </span>{t("trackingApplication")} <strong>{ref}</strong>
        </div>
      )}

      {phase === "email" ? (
        <form onSubmit={requestOtp} style={{ display: "grid", gap: 14 }}>
          <div>
            <label htmlFor="careers-login-email" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
              {t("emailLabel")}
            </label>
            <input
              id="careers-login-email" ref={emailRef}
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              aria-invalid={emailInvalid || undefined}
              aria-describedby={emailInvalid ? "careers-login-email-error" : "careers-login-email-hint"}
              style={{ width: "100%", padding: "11px 14px", fontSize: 14, border: "1px solid #cbd5e1", borderRadius: 9, boxSizing: "border-box" }}
            />
          </div>
          {emailInvalid && errorBox("careers-login-email-error")}
          <button type="submit" disabled={status === "loading"}
            style={{ padding: "13px 24px", fontSize: 15, fontWeight: 700, color: "#fff", background: status === "loading" ? DISABLED_BG : GOV_BLUE, border: "none", borderRadius: 10, cursor: "pointer", minHeight: 48 }}>
            {status === "loading" ? t("sending") : t("sendCode")}
          </button>
          <p id="careers-login-email-hint" style={{ margin: 0, fontSize: 12, color: MUTED, textAlign: "center" }}>
            {t("emailHint")}
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} style={{ display: "grid", gap: 14 }}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <p aria-hidden="true" style={{ margin: "0 0 6px", fontSize: 24 }}>📨</p>
            <p style={{ margin: 0, fontSize: 14, color: "#334155" }}>
              {t("codeSentTo")} <strong>{email}</strong>
            </p>
          </div>
          <div>
            <label htmlFor="careers-login-otp" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
              {t("otpLabel")}
            </label>
            <input
              id="careers-login-otp" ref={otpRef}
              type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t("otpPlaceholder")}
              aria-invalid={otpInvalid || undefined}
              aria-describedby={otpInvalid ? "careers-login-otp-error" : undefined}
              style={{ width: "100%", padding: "11px 14px", fontSize: 18, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.15em", border: "2px solid #154089", borderRadius: 9, boxSizing: "border-box", textAlign: "center" }}
            />
          </div>
          {otpInvalid && errorBox("careers-login-otp-error")}
          {status === "error" && errorField === "email" && errorBox("careers-login-resend-error")}
          <p data-testid="otp-expiry" role={expired ? "alert" : undefined} style={{ margin: 0, fontSize: 12, color: expired ? "#b91c1c" : MUTED, textAlign: "center" }}>
            {expired ? t("codeExpired") : t("codeExpiresIn", { time: formatCountdown((expiresAt - now) / 1000) })}
          </p>
          <button type="submit" disabled={verifyDisabled}
            style={{ padding: "13px 24px", fontSize: 15, fontWeight: 700, color: "#fff", background: verifyDisabled ? DISABLED_BG : GOV_BLUE, border: "none", borderRadius: 10, cursor: verifyDisabled ? "default" : "pointer", minHeight: 48 }}>
            {status === "loading" ? t("verifying") : t("verify")}
          </button>
          <button type="button" onClick={() => void sendCode()} disabled={status === "loading" || resendWait > 0}
            style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 14px", minHeight: 44, color: resendWait > 0 ? MUTED : GOV_BLUE, fontSize: 14, fontWeight: 600, cursor: resendWait > 0 ? "default" : "pointer" }}>
            {resendWait > 0 ? t("resendIn", { seconds: resendWait }) : t("resend")}
          </button>
          <button type="button" onClick={() => { setPhase("email"); setOtp(""); setStatus("idle"); setError(""); setErrorField(null); }}
            style={{ background: "none", border: "none", color: MUTED, fontSize: 14, minHeight: 44, cursor: "pointer", textDecoration: "underline" }}>
            {t("useDifferentEmail")}
          </button>
        </form>
      )}
    </div>
  );
}

/** useSearchParams needs a Suspense boundary; the fallback keeps the shell from being blank while it resolves. */
export function LoginForm() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginFormInner />
    </Suspense>
  );
}
