import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { isDevLoginEnabled } from "@/lib/auth/env";
import { DevLoginForm } from "./DevLoginForm";

export const dynamic = "force-dynamic";

const wrap: CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  padding: "24px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  background: "#0f172a",
  backgroundImage: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)",
};
const card: CSSProperties = {
  width: "100%", maxWidth: "400px", background: "#ffffff", borderRadius: "16px",
  padding: "32px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)", boxSizing: "border-box",
};
// GAP-AUTH-DEV-03: a prominent, non-dismissable "test environment" banner so
// nobody mistakes this bypass screen for the real sign-in. Uses amber warning
// colours and role=note for assistive tech.
const envBanner: CSSProperties = {
  marginBottom: "20px", padding: "10px 12px", borderRadius: "9px",
  background: "#fffbeb", border: "1px solid #f59e0b", color: "#92400e",
  fontSize: "12.5px", fontWeight: 600, textAlign: "center",
};
const badge: CSSProperties = {
  width: "52px", height: "52px", margin: "0 auto 14px", borderRadius: "14px",
  background: "#6366f1",
  backgroundImage: "linear-gradient(135deg,#6366f1,#4338ca)", color: "#fff",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: "15px", fontWeight: 700, letterSpacing: "0.5px",
};
const h1: CSSProperties = { margin: 0, textAlign: "center", fontSize: "22px", fontWeight: 700, color: "#0f172a" };
const sub: CSSProperties = { margin: "6px 0 24px", textAlign: "center", fontSize: "14px", color: "#64748b" };
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

// Focus-visible rings and :hover/:disabled states cannot be expressed via inline
// styles, so the dev-login form uses class names with a scoped <style> block
// (keeps a keyboard-visible focus indicator — WCAG 2.4.7).
const FORM_STYLES = `
  .devlogin-label {
    display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #334155;
  }
  .devlogin-label-hint { font-weight: 400; color: #64748b; }
  .devlogin-input {
    width: 100%; padding: 11px 12px; margin-bottom: 16px; font-size: 14px;
    border: 1px solid #cbd5e1; border-radius: 9px; box-sizing: border-box; color: #0f172a;
    background: #fff;
  }
  .devlogin-input:focus-visible {
    outline: 2px solid #4f46e5; outline-offset: 2px; border-color: #4f46e5;
  }
  .devlogin-btn {
    width: 100%; padding: 12px; font-size: 15px; font-weight: 600; color: #fff;
    background: #4f46e5; border: none; border-radius: 9px; cursor: pointer;
  }
  .devlogin-btn:hover { background: #4338ca; }
  .devlogin-btn:focus-visible { outline: 2px solid #1e1b4b; outline-offset: 2px; }
  .devlogin-btn:disabled { opacity: 0.6; cursor: progress; }
`;

export default function DevLoginPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  if (!isDevLoginEnabled()) notFound();
  const next = searchParams?.next ?? "";
  return (
    <main style={wrap}>
      <style>{FORM_STYLES}</style>
      <div style={card}>
        <div style={envBanner} role="note">
          ⚠ TEST ENVIRONMENT — not for production data
        </div>
        <div style={badge} aria-hidden="true">TEST</div>
        <h1 style={h1}>CivitasOne Suite</h1>
        <p style={sub}>Government &amp; Enterprise Platform · Test Sign-in</p>

        {searchParams?.error ? (
          <div style={errBox} role="alert">Invalid username or password. Please try again.</div>
        ) : null}

        <DevLoginForm next={next} />

        <div style={hint}>
          {/* GAP-AUTH-DEV-01: the shared demo password is NOT rendered here.
              It lives only in the untracked apps/web/.env (DEV_LOGIN_PASSWORD)
              and is documented in the README. */}
          <div style={hintTitle}>Demo accounts</div>
          <div style={row}><span style={userTag}>dnayak</span><span>D. Nayak — HR Admin (Digital India)</span></div>
          <div style={row}><span style={userTag}>superadmin</span><span>Full access · all modules</span></div>
          <div style={row}><span style={userTag}>hrofficer</span><span>HR / Establishment Officer</span></div>
          <div style={row}><span style={userTag}>officer</span><span>Finance · HR · Procurement</span></div>
          {/* GAP-AUTH-DEV-06: the auditor persona's roles are audit_officer,
              audit_admin, reader, viewer — there is no legal role, so the
              description must not claim "Legal". */}
          <div style={row}><span style={userTag}>auditor</span><span>Audit (read-only)</span></div>
        </div>
      </div>
    </main>
  );
}
