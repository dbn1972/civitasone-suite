"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const GOV_BLUE = "#154089";
/** Minimum gap between code sends from this form. The server TTL/attempt limits are unchanged. */
export const RESEND_COOLDOWN_SECONDS = 30;
const DEFAULT_EXPIRES_IN_SECONDS = 600;

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"email" | "otp">("email");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (phase !== "otp") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const expired = phase === "otp" && now >= expiresAt;
  const resendWait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function sendCode() {
    if (!email.trim()) return;
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/careers/auth/otp-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { message?: string }).message ?? "Could not send OTP");
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
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
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
    try {
      const res = await fetch("/api/careers/auth/otp-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otp }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { code?: string; message?: string };
        if (res.status === 429 || d.code === "MAX_ATTEMPTS") {
          setLocked(true);
          throw new Error("Too many attempts. Request a new code.");
        }
        throw new Error(d.message ?? "Invalid code");
      }
      router.push(ref ? `/careers/portal?ref=${encodeURIComponent(ref)}` : "/careers/portal");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "0 16px" }}>
      {/* Header */}
      <div style={{ background: GOV_BLUE, borderRadius: 12, padding: "24px 24px 20px", marginBottom: 20, color: "#fff", textAlign: "center" }}>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "#93c5fd" }}>Government of India</p>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800 }}>Candidate Portal</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#93c5fd" }}>Sign in to track your applications</p>
      </div>

      {ref && (
        <div style={{ background: "#cffafe", border: "1px solid #a5f3fc", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#0e7490" }}>
          📋 You'll be tracking application <strong>{ref}</strong>
        </div>
      )}

      {phase === "email" ? (
        <form onSubmit={requestOtp} style={{ display: "grid", gap: 14 }}>
          <div>
            <label htmlFor="careers-login-email" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
              Email address you applied with
            </label>
            <input
              id="careers-login-email"
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. priya@example.com"
              style={{ width: "100%", padding: "11px 14px", fontSize: 14, border: "1px solid #cbd5e1", borderRadius: 9, boxSizing: "border-box" }}
            />
          </div>
          {status === "error" && <p style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={status === "loading"}
            style={{ padding: "13px 24px", fontSize: 15, fontWeight: 700, color: "#fff", background: status === "loading" ? "#94a3b8" : GOV_BLUE, border: "none", borderRadius: 10, cursor: "pointer", minHeight: 48 }}>
            {status === "loading" ? "Sending…" : "Send one-time code →"}
          </button>
          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
            A 6-digit code will be sent to your inbox. No password needed.
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} style={{ display: "grid", gap: 14 }}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <p style={{ margin: "0 0 6px", fontSize: 24 }}>📨</p>
            <p style={{ margin: 0, fontSize: 14, color: "#334155" }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </p>
          </div>
          <div>
            <label htmlFor="careers-login-otp" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
              Enter the 6-digit code
            </label>
            <input
              id="careers-login-otp"
              type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="e.g. 472839"
              style={{ width: "100%", padding: "11px 14px", fontSize: 18, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.15em", border: "2px solid #154089", borderRadius: 9, boxSizing: "border-box", textAlign: "center" }}
            />
          </div>
          {status === "error" && <p style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 13 }}>{error}</p>}
          <p data-testid="otp-expiry" role={expired ? "alert" : undefined} style={{ margin: 0, fontSize: 12, color: expired ? "#b91c1c" : "#64748b", textAlign: "center" }}>
            {expired ? "Code expired. Request a new code." : `Code expires in ${formatCountdown((expiresAt - now) / 1000)}`}
          </p>
          <button type="submit" disabled={status === "loading" || otp.length !== 6 || expired || locked}
            style={{ padding: "13px 24px", fontSize: 15, fontWeight: 700, color: "#fff", background: otp.length !== 6 || status === "loading" || expired || locked ? "#94a3b8" : GOV_BLUE, border: "none", borderRadius: 10, cursor: otp.length !== 6 || expired || locked ? "default" : "pointer", minHeight: 48 }}>
            {status === "loading" ? "Verifying…" : "Verify & sign in →"}
          </button>
          <button type="button" onClick={() => void sendCode()} disabled={status === "loading" || resendWait > 0}
            style={{ background: "none", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 14px", color: resendWait > 0 ? "#94a3b8" : GOV_BLUE, fontSize: 13, fontWeight: 600, cursor: resendWait > 0 ? "default" : "pointer" }}>
            {resendWait > 0 ? `Resend code in ${resendWait}s` : "Resend code"}
          </button>
          <button type="button" onClick={() => { setPhase("email"); setOtp(""); setStatus("idle"); setError(""); }}
            style={{ background: "none", border: "none", color: "#64748b", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
            ← Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
