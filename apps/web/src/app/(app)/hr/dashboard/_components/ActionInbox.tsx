"use client";
import { useState } from "react";
import Link from "next/link";
import type { LeaveInboxItem } from "@civitasone/types";

const LEAVE_COLORS: Record<string, { bg: string; color: string }> = {
  EL:  { bg: "#eff6ff", color: "#2563eb" },
  CL:  { bg: "#fffbeb", color: "#d97706" },
  ML:  { bg: "#fef2f2", color: "#dc2626" },
  HPL: { bg: "#fef2f2", color: "#dc2626" },
  PL:  { bg: "#f0fdf4", color: "#16a34a" },
  CCL: { bg: "#fdf4ff", color: "#9333ea" },
};

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}
const AVATAR_BG = ["#dbeafe","#fce7f3","#d1fae5","#fef3c7","#e0e7ff","#fee2e2"];
const AVATAR_FG = ["#1e40af","#9d174d","#065f46","#92400e","#3730a3","#991b1b"];

interface Props { initialItems: LeaveInboxItem[] }

export function ActionInbox({ initialItems }: Props) {
  const [items, setItems] = useState<LeaveInboxItem[]>(initialItems);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function act(id: string, action: "approve" | "reject") {
    setLoading((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/proxy/v1/hrms/leave-applications/${id}/${action}`, { method: "PATCH" });
      if (res.ok) {
        setItems((p) => p.filter((i) => i.id !== id));
      } else {
        const msg = await res.json().then((d) => d?.error ?? d?.message ?? `Error ${res.status}`).catch(() => `Error ${res.status}`);
        setErrors((p) => ({ ...p, [id]: msg }));
      }
    } finally {
      setLoading((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <div className="inbox-panel">
      <div className="inbox-head">
        <span className="inbox-title">
          <span className="inbox-dot" />
          Action Required — Leave Approvals
        </span>
        <Link href="/hr/leave/approvals" className="inbox-link">Manage all →</Link>
      </div>

      {items.length === 0 ? (
        <div className="inbox-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.5" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <p>Inbox clear — no pending approvals</p>
        </div>
      ) : (
        items.map((item, idx) => {
          const codeKey = item.leaveTypeCode.toUpperCase();
          const tag = LEAVE_COLORS[codeKey] ?? { bg: "#f1f5f9", color: "#64748b" };
          const bi = idx % AVATAR_BG.length;
          return (
            <div key={item.id} className="inbox-item">
              <div className="inbox-avatar" style={{ background: AVATAR_BG[bi], color: AVATAR_FG[bi] }}>
                {initials(item.employeeName)}
              </div>
              <div className="inbox-info">
                <div className="inbox-name">{item.employeeName}</div>
                <div className="inbox-meta">
                  <span className="leave-tag" style={{ background: tag.bg, color: tag.color }}>
                    {item.leaveTypeName}
                  </span>
                  {item.fromDate} – {item.toDate} · {item.daysApplied} day{item.daysApplied !== 1 ? "s" : ""} · {item.departmentName}
                </div>
              </div>
              <div className="inbox-actions">
                {errors[item.id] ? (
                  <span className="inbox-error" role="alert">{errors[item.id]}</span>
                ) : (
                  <>
                    <button
                      className="btn-approve"
                      disabled={loading[item.id]}
                      onClick={() => act(item.id, "approve")}
                      aria-label={`Approve leave for ${item.employeeName}`}
                    >✓ Approve</button>
                    <button
                      className="btn-decline"
                      disabled={loading[item.id]}
                      onClick={() => act(item.id, "reject")}
                      aria-label={`Decline leave for ${item.employeeName}`}
                    >✕</button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}

      <style>{`
        .inbox-panel { background: var(--surface,#fff); border-radius:8px; box-shadow:0 1px 3px rgba(15,34,64,.09); overflow:hidden; }
        .inbox-head { padding:13px 16px 11px; border-bottom:1px solid var(--border,#e2e8f0); display:flex; align-items:center; justify-content:space-between; }
        .inbox-title { font-size:12px; font-weight:700; display:flex; align-items:center; gap:7px; }
        .inbox-dot { width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0; }
        .inbox-link { font-size:11px; color:#2563eb; font-weight:600; text-decoration:none; }
        .inbox-empty { padding:28px 16px; text-align:center; color:var(--muted,#64748b); font-size:12px; display:flex; flex-direction:column; align-items:center; gap:8px; }
        .inbox-item { display:grid; grid-template-columns:36px 1fr auto; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--border,#e2e8f0); }
        .inbox-item:last-child { border-bottom:none; }
        .inbox-avatar { width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0; }
        .inbox-name { font-size:13px;font-weight:600;color:var(--text,#0f172a); }
        .inbox-meta { font-size:11px;color:var(--muted,#64748b);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap; }
        .leave-tag { display:inline-flex;align-items:center;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600; }
        .inbox-actions { display:flex;gap:5px;flex-shrink:0; }
        .btn-approve { background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:5px;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer; }
        .btn-approve:disabled { opacity:.5;cursor:not-allowed; }
        .btn-decline { background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer; }
        .btn-decline:disabled { opacity:.5;cursor:not-allowed; }
        .inbox-error { font-size:11px;color:#dc2626;font-weight:600;white-space:nowrap; }
      `}</style>
    </div>
  );
}
