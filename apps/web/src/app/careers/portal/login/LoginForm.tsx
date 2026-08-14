"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const GOV_BLUE = "#154089";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"email" | "otp">("email");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
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
      const data = await res.json() as { devCode?: string };
      if (data.devCode) setOtp(data.devCode);
      setPhase("otp");
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
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
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { message?: string }).message ?? "Invalid code");
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
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
              Email address you applied with
            </label>
            <input
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
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 5 }}>
              Enter the 6-digit code
            </label>
            <input
              type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="e.g. 472839"
              style={{ width: "100%", padding: "11px 14px", fontSize: 18, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.15em", border: "2px solid #154089", borderRadius: 9, boxSizing: "border-box", textAlign: "center" }}
            />
          </div>
          {status === "error" && <p style={{ margin: 0, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 13 }}>{error}</p>}
          <button type="submit" disabled={status === "loading" || otp.length !== 6}
            style={{ padding: "13px 24px", fontSize: 15, fontWeight: 700, color: "#fff", background: otp.length !== 6 || status === "loading" ? "#94a3b8" : GOV_BLUE, border: "none", borderRadius: 10, cursor: otp.length !== 6 ? "default" : "pointer", minHeight: 48 }}>
            {status === "loading" ? "Verifying…" : "Verify & sign in →"}
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
