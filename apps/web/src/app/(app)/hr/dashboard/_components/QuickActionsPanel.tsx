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
    iconColor: "var(--infobg, #eff6ff)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--info, #2563eb)" strokeWidth="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  },
  {
    label: "Run Payroll",
    desc: "Current month cycle",
    href: "/hr/payroll",
    iconColor: "var(--goodbg, #f0fdf4)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--good, #16a34a)" strokeWidth="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
  {
    label: "Approve Leaves",
    desc: "Pending approvals",
    href: "/hr/leave/approvals",
    iconColor: "var(--badbg, #fef2f2)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--bad, #dc2626)" strokeWidth="2" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  },
  {
    label: "Download Report",
    desc: "Headcount & leaves",
    href: "/hr/payroll",
    iconColor: "var(--warnbg, #fffbeb)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--warn, #d97706)" strokeWidth="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  },
];

// Manager-role counterpart: "manager" is isHRStaff (HR_DASHBOARD_READER_ROLES
// in hr/dashboard/page.tsx includes it, so a manager reaches this branch of
// the dashboard, not the plain-employee one below) but is NOT in
// EMPLOYEE_ADMIN_ROLES (hr/employees/new/page.tsx's own POST gate) -- "Add
// Employee" 403s for that role same as for a plain employee. Run
// Payroll/Approve Leaves/Download Report all lead to pages that render
// successfully for a manager (hr/payroll's own canAdminister flag just hides
// the run-payroll form inside the page; hr/leave/approvals is manager
// territory), so only the one blocked action is dropped, not the whole set.
const MANAGER_ACTIONS: QuickAction[] = ACTIONS.filter((a) => a.label !== "Add Employee");

// Employee-role counterpart: none of ACTIONS above apply to a plain
// employee (add-employee/run-payroll/approve-leaves/download-org-report
// are all HR-admin-only, and the backend 403s them for that role) -- see
// hr/dashboard/page.tsx's isHRStaff branch.
const EMPLOYEE_ACTIONS: QuickAction[] = [
  {
    label: "Apply for Leave",
    desc: "New leave request",
    href: "/hr/leave/apply",
    iconColor: "var(--infobg, #eff6ff)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--info, #2563eb)" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  },
  {
    label: "My Leave Balance",
    desc: "Days available by type",
    href: "/hr/leave/balance",
    iconColor: "var(--goodbg, #f0fdf4)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--good, #16a34a)" strokeWidth="2" aria-hidden="true"><path d="M12 2v20M2 12h20"/></svg>,
  },
  {
    label: "My Leave History",
    desc: "Past & pending requests",
    href: "/hr/leave/history",
    iconColor: "var(--warnbg, #fffbeb)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--warn, #d97706)" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
];

interface Props {
  variant?: "admin" | "employee" | "manager";
  /** Only used when variant="employee", to build the "My Profile" link. Omitted (no linked employee record yet) simply drops that one action. */
  myEmployeeId?: string | null;
}

export function QuickActionsPanel({ variant = "admin", myEmployeeId }: Props = {}) {
  const actions: QuickAction[] = variant === "employee"
    ? [
        ...EMPLOYEE_ACTIONS,
        ...(myEmployeeId ? [{
          label: "My Profile",
          desc: "View my employee record",
          href: `/hr/employees/${myEmployeeId}`,
          iconColor: "var(--bg, #f1f5f9)",
          icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--mut, #64748b)" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>,
        }] : []),
      ]
    : variant === "manager"
    ? MANAGER_ACTIONS
    : ACTIONS;

  return (
    <div className="qa-panel">
      <div className="qa-head">
        <span className="qa-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--info, #2563eb)" strokeWidth="2.5" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Quick Actions
        </span>
      </div>
      <div className="qa-grid">
        {actions.map((a) => (
          <Link key={a.label} href={a.href} className="qa-btn">
            <div className="qa-icon" style={{ background: a.iconColor }}>{a.icon}</div>
            <div>
              <div className="qa-label">{a.label}</div>
              <div className="qa-desc">{a.desc}</div>
            </div>
          </Link>
        ))}
      </div>
      <style>{`
        .qa-panel { background:var(--panel,#fff);border-radius:8px;box-shadow:0 1px 3px rgba(15,34,64,.09);overflow:hidden; }
        .qa-head { padding:13px 16px 11px;border-bottom:1px solid var(--line,#e2e8f0); }
        .qa-title { font-size:12px;font-weight:700;display:flex;align-items:center;gap:7px; }
        .qa-grid { padding:12px;display:flex;flex-direction:column;gap:8px; }
        .qa-btn { display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:7px;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);text-decoration:none;transition:border-color .15s,box-shadow .15s; }
        .qa-btn:hover { border-color:var(--info, #2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.08); }
        .qa-icon { width:32px;height:32px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .qa-label { font-size:12px;font-weight:600;color:var(--ink,#0f172a); }
        .qa-desc { font-size:10px;color:var(--muted,#64748b);margin-top:1px; }
      `}</style>
    </div>
  );
}
