import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { isDevLoginEnabled } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

const wrap: CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  padding: "24px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)",
};
const card: CSSProperties = {
  width: "100%", maxWidth: "400px", background: "#ffffff", borderRadius: "16px",
  padding: "32px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)", boxSizing: "border-box",
};
const badge: CSSProperties = {
  width: "52px", height: "52px", margin: "0 auto 14px", borderRadius: "14px",
  background: "linear-gradient(135deg,#6366f1,#4338ca)", color: "#fff",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px",
};
const h1: CSSProperties = { margin: 0, textAlign: "center", fontSize: "22px", fontWeight: 700, color: "#0f172a" };
const sub: CSSProperties = { margin: "6px 0 24px", textAlign: "center", fontSize: "14px", color: "#64748b" };
const label: CSSProperties = { display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600, color: "#334155" };
const input: CSSProperties = {
  width: "100%", padding: "11px 12px", marginBottom: "16px", fontSize: "14px",
  border: "1px solid #cbd5e1", borderRadius: "9px", boxSizing: "border-box", color: "#0f172a", outline: "none",
};
const button: CSSProperties = {
  width: "100%", padding: "12px", fontSize: "15px", fontWeight: 600, color: "#fff",
  background: "#4f46e5", border: "none", borderRadius: "9px", cursor: "pointer",
};
const errBox: CSSProperties = {
  marginBottom: "18px", padding: "10px 12px", borderRadius: "9px",
  background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: "13px",
};
const hint: CSSProperties = {
  marginTop: "24px", padding: "14px", borderRadius: "10px",
  background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: "12.5px", color: "#475569",
};
const hintTitle: CSSProperties = { fontWeight: 700, color: "#334155", marginBottom: "6px" };
const row: CSSProperties = { display: "flex", justifyContent: "space-between", padding: "3px 0" };
const userTag: CSSProperties = { fontWeight: 600, color: "#4f46e5", fontFamily: "ui-monospace, monospace" };

export default function DevLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (!isDevLoginEnabled()) notFound();
  return (
    <main style={wrap}>
      <div style={card}>
        <div style={badge}>◈</div>
        <h1 style={h1}>CivitasOne Suite</h1>
        <p style={sub}>Government &amp; Enterprise Platform · Test Sign-in</p>

        {searchParams?.error ? (
          <div style={errBox} role="alert">Invalid username or password. Please try again.</div>
        ) : null}

        <form method="POST" action="/api/auth/dev-login">
          <label htmlFor="username" style={label}>Username</label>
          <input id="username" name="username" autoComplete="username" required
            placeholder="superadmin" style={input} />

          <label htmlFor="password" style={label}>Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            placeholder="••••••••" style={input} />

          <button type="submit" style={button}>Sign in →</button>
        </form>

        <div style={hint}>
          <div style={hintTitle}>Demo accounts — password <code style={userTag}>Civitas@123</code></div>
          <div style={row}><span style={userTag}>superadmin</span><span>Full access · all modules</span></div>
          <div style={row}><span style={userTag}>officer</span><span>Finance · HR · Procurement</span></div>
          <div style={row}><span style={userTag}>auditor</span><span>Audit · Legal</span></div>
        </div>
      </div>
    </main>
  );
}
