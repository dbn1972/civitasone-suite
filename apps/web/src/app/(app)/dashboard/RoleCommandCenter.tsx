import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSessionRoles, hasRoleFamily } from "@/lib/auth/roleGuard";

type Action = { label: string; href: string; note: string };

const CENTERS: Array<{
  id: string;
  title: string;
  match: (roles: string[]) => boolean;
  actions: Action[];
}> = [
  {
    id: "finance",
    title: "Finance Command Center",
    match: (r) => hasRoleFamily(r, "finance"),
    actions: [
      { label: "Pending bills", href: "/finance/expenditure/bills", note: "Approve or return for correction" },
      { label: "Sanctions queue", href: "/finance/budget/sanctions", note: "Budget availability before spend" },
      { label: "Payment run", href: "/finance/payments", note: "Treasury disbursement" },
      { label: "Period close", href: "/finance/period-close", note: "Hard-close readiness" },
    ],
  },
  {
    id: "procurement",
    title: "Procurement Command Center",
    match: (r) => hasRoleFamily(r, "procurement"),
    actions: [
      { label: "Open indents", href: "/procurement/indents", note: "Review and sanction" },
      { label: "PO approvals", href: "/procurement/orders", note: "Commit funds with budget check" },
      { label: "GRN pending", href: "/procurement/grn", note: "Receipt → stock/asset" },
      { label: "Vendor KYC", href: "/procurement/vendors", note: "Blocked vendors halt PO" },
    ],
  },
  {
    id: "hr",
    title: "HR & Payroll Command Center",
    match: (r) => hasRoleFamily(r, "hr") || hasRoleFamily(r, "payroll"),
    actions: [
      { label: "Leave approvals", href: "/hr/leave/approvals", note: "Maker-checker leave queue" },
      { label: "Payroll run", href: "/hr/payroll", note: "Approve → GL → payment" },
      { label: "Attendance exceptions", href: "/hr/attendance", note: "Regularization pending" },
    ],
  },
  {
    id: "audit",
    title: "Audit Command Center",
    match: (r) => hasRoleFamily(r, "audit"),
    actions: [
      { label: "Open observations", href: "/audit/observations", note: "Compliance follow-up" },
      { label: "Risk register", href: "/audit/risk-register", note: "Escalated risks" },
      { label: "Audit trail export", href: "/audit/exports", note: "Immutable evidence" },
    ],
  },
  {
    id: "admin",
    title: "Tenant Admin Command Center",
    match: (r) => hasRoleFamily(r, "admin") || hasRoleFamily(r, "tenant"),
    actions: [
      { label: "Pending users", href: "/tenant-admin/users", note: "Access provisioning" },
      { label: "Roles & policies", href: "/tenant-admin/roles", note: "RBAC alignment" },
      { label: "Break-glass log", href: "/tenant-admin/breakglass", note: "Emergency access review" },
    ],
  },
  {
    id: "grants",
    title: "Grants Command Center",
    match: (r) => hasRoleFamily(r, "grant"),
    actions: [
      { label: "Pending applications", href: "/grants/applications", note: "Appraise or approve grant applications" },
      { label: "Overdue UCs", href: "/grants/utilization", note: "Utilization certificates awaiting verification" },
      { label: "Installments due", href: "/grants/installments", note: "Release pending installments" },
      { label: "Scheme register", href: "/grants/schemes", note: "Manage active grant schemes" },
    ],
  },
  {
    id: "projects",
    title: "Projects Command Center",
    match: (r) => hasRoleFamily(r, "project"),
    actions: [
      { label: "Milestones due", href: "/projects/milestones", note: "Track overdue milestones" },
      { label: "Fund releases", href: "/projects/fund-releases", note: "Pending release approvals" },
      { label: "Active projects", href: "/projects/list", note: "Physical & financial progress" },
    ],
  },
  {
    id: "legal",
    title: "Legal Command Center",
    match: (r) => hasRoleFamily(r, "legal"),
    actions: [
      { label: "Upcoming hearings", href: "/legal/hearings", note: "Next 7 days — prepare briefs" },
      { label: "Court orders pending", href: "/legal/court-orders", note: "Compliance action required" },
      { label: "Case register", href: "/legal/list", note: "All active litigation" },
      { label: "Legal opinions", href: "/legal/opinions", note: "Pending opinion requests" },
    ],
  },
];

export function RoleCommandCenter() {
  const roles = getSessionRoles();
  const centers = CENTERS.filter((c) => c.match(roles));
  if (centers.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
      {centers.map((center) => (
        <section key={center.id} className="card" aria-labelledby={`cc-${center.id}-h`}>
          <div className="card-h">
            <h2 id={`cc-${center.id}-h`} style={{ margin: 0 }}>{center.title}</h2>
            <Link href="/workflow" className="btn ghost" style={{ fontSize: 12 }}>
              All approvals{" "}
              {/* Icon, not a "→" text glyph -- see page.tsx's ArrowRight for why. */}
              <ArrowRight aria-hidden="true" size={12} style={{ verticalAlign: "middle" }} />
            </Link>
          </div>
          <div className="pad">
            {/*
              GAP-DASHBOARD-HOME-2-01: these are role shortcuts, not a live
              action queue. The old copy claimed "What needs your action now"
              and every "urgent" item showed a red "Urgent" pill + red left
              border regardless of whether anything was actually pending, so an
              empty queue still screamed urgency. Until these tiles are bound to
              real counts (workflow inbox etc.), present them honestly as
              shortcuts with no fabricated urgency.
            */}
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, marginBottom: 12 }}>
              Shortcuts for your role.
            </p>
            <div className="grid g-2">
              {center.actions.map((a) => (
                <Link key={a.href} href={a.href} style={{ textDecoration: "none" }}>
                  <div
                    className="stat"
                    style={{
                      cursor: "pointer",
                      height: "100%",
                      borderLeft: "3px solid transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{a.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{a.note}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
