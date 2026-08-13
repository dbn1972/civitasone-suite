"use client";
import Link from "next/link";

interface QuickAction {
  label: string;
  desc: string;
  href: string;
  iconColor: string;
  icon: React.ReactNode;
}

import type React from "react";

const ACTIONS: QuickAction[] = [
  {
    label: "Add Employee",
    desc: "Onboard new hire",
    href: "/hr/employees/new",
    iconColor: "#eff6ff",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  },
  {
    label: "Run Payroll",
    desc: "Current month cycle",
    href: "/hr/payroll/period",
    iconColor: "#f0fdf4",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
  {
    label: "Approve Leaves",
    desc: "Pending approvals",
    href: "/hr/leave/approvals",
    iconColor: "#fef2f2",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  },
  {
    label: "Download Report",
    desc: "Headcount & leaves",
    href: "/hr/payroll",
    iconColor: "#fffbeb",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  },
];

export function QuickActionsPanel() {
  return (
    <div className="qa-panel">
      <div className="qa-head">
        <span className="qa-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Quick Actions
        </span>
      </div>
      <div className="qa-grid">
        {ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} className="qa-btn">
            <div className="qa-icon" style={{ background: a.iconColor }}>{a.icon}</div>
            <div>
              <div className="qa-label">{a.label}</div>
              <div className="qa-desc">{a.desc}</div>
            </div>
          </Link>
        ))}
      </div>
      <style>{`
        .qa-panel { background:var(--surface,#fff);border-radius:8px;box-shadow:0 1px 3px rgba(15,34,64,.09);overflow:hidden; }
        .qa-head { padding:13px 16px 11px;border-bottom:1px solid var(--border,#e2e8f0); }
        .qa-title { font-size:12px;font-weight:700;display:flex;align-items:center;gap:7px; }
        .qa-grid { padding:12px;display:flex;flex-direction:column;gap:8px; }
        .qa-btn { display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:7px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);text-decoration:none;transition:border-color .15s,box-shadow .15s; }
        .qa-btn:hover { border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.08); }
        .qa-icon { width:32px;height:32px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .qa-label { font-size:12px;font-weight:600;color:var(--text,#0f172a); }
        .qa-desc { font-size:10px;color:var(--muted,#64748b);margin-top:1px; }
      `}</style>
    </div>
  );
}
