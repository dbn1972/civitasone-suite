import Link from "next/link";
import { getSessionRoles } from "@/lib/auth/roleGuard";

type Action = { label: string; href: string; note: string; priority: "urgent" | "normal" };

const CENTERS: Array<{
  id: string;
  title: string;
  match: (roles: string[]) => boolean;
  actions: Action[];
}> = [
  {
    id: "finance",
    title: "Finance Command Center",
    match: (r) => r.some((x) => x.includes("finance")),
    actions: [
      { label: "Pending bills", href: "/finance/expenditure/bills", note: "Approve or return for correction", priority: "urgent" },
      { label: "Sanctions queue", href: "/finance/budget/sanctions", note: "Budget availability before spend", priority: "urgent" },
      { label: "Payment run", href: "/finance/payments", note: "Treasury disbursement", priority: "normal" },
      { label: "Period close", href: "/finance/accounting/period-close", note: "Hard-close readiness", priority: "normal" },
    ],
  },
  {
    id: "procurement",
    title: "Procurement Command Center",
    match: (r) => r.some((x) => x.includes("procurement")),
    actions: [
      { label: "Open indents", href: "/procurement/indents", note: "Review and sanction", priority: "urgent" },
      { label: "PO approvals", href: "/procurement/purchase-orders", note: "Commit funds with budget check", priority: "urgent" },
      { label: "GRN pending", href: "/procurement/grn", note: "Receipt → stock/asset", priority: "normal" },
      { label: "Vendor KYC", href: "/procurement/vendors", note: "Blocked vendors halt PO", priority: "normal" },
    ],
  },
  {
    id: "hr",
    title: "HR & Payroll Command Center",
    match: (r) => r.some((x) => x.includes("hr") || x.includes("payroll")),
    actions: [
      { label: "Leave approvals", href: "/hr/leave/approvals", note: "Maker-checker leave queue", priority: "urgent" },
      { label: "Payroll run", href: "/hr/payroll", note: "Approve → GL → payment", priority: "urgent" },
      { label: "Attendance exceptions", href: "/hr/attendance", note: "Regularization pending", priority: "normal" },
    ],
  },
  {
    id: "audit",
    title: "Audit Command Center",
    match: (r) => r.some((x) => x.includes("audit")),
    actions: [
      { label: "Open observations", href: "/audit/observations", note: "Compliance follow-up", priority: "urgent" },
      { label: "Risk register", href: "/audit/risk", note: "Escalated risks", priority: "normal" },
      { label: "Audit trail export", href: "/audit/trail", note: "Immutable evidence", priority: "normal" },
    ],
  },
  {
    id: "admin",
    title: "Tenant Admin Command Center",
    match: (r) => r.some((x) => x.includes("admin") || x.includes("tenant")),
    actions: [
      { label: "Pending users", href: "/tenant-admin/users", note: "Access provisioning", priority: "urgent" },
      { label: "Roles & policies", href: "/tenant-admin/roles", note: "RBAC alignment", priority: "normal" },
      { label: "Break-glass log", href: "/tenant-admin/breakglass", note: "Emergency access review", priority: "urgent" },
    ],
  },
  {
    id: "grants",
    title: "Grants Command Center",
    match: (r) => r.some((x) => x.includes("grant")),
    actions: [
      { label: "Pending applications", href: "/grants/applications", note: "Appraise or approve grant applications", priority: "urgent" },
      { label: "Overdue UCs", href: "/grants/utilization", note: "Utilization certificates awaiting verification", priority: "urgent" },
      { label: "Installments due", href: "/grants/installments", note: "Release pending installments", priority: "normal" },
      { label: "Scheme register", href: "/grants/schemes", note: "Manage active grant schemes", priority: "normal" },
    ],
  },
  {
    id: "projects",
    title: "Projects Command Center",
    match: (r) => r.some((x) => x.includes("project")),
    actions: [
      { label: "Milestones due", href: "/projects/milestones", note: "Track overdue milestones", priority: "urgent" },
      { label: "Fund releases", href: "/projects/fund-releases", note: "Pending release approvals", priority: "urgent" },
      { label: "Active projects", href: "/projects/list", note: "Physical & financial progress", priority: "normal" },
    ],
  },
  {
    id: "legal",
    title: "Legal Command Center",
    match: (r) => r.some((x) => x.includes("legal")),
    actions: [
      { label: "Upcoming hearings", href: "/legal/hearings", note: "Next 7 days — prepare briefs", priority: "urgent" },
      { label: "Court orders pending", href: "/legal/court-orders", note: "Compliance action required", priority: "urgent" },
      { label: "Case register", href: "/legal/list", note: "All active litigation", priority: "normal" },
      { label: "Legal opinions", href: "/legal/opinions", note: "Pending opinion requests", priority: "normal" },
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
              All approvals <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="pad">
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, marginBottom: 12 }}>
              What needs your action now — prioritized for your role.
            </p>
            <div className="grid g-2">
              {center.actions.map((a) => {
                const urgent = a.priority === "urgent";
                return (
                  <Link key={a.href} href={a.href} style={{ textDecoration: "none" }}>
                    <div
                      className="stat"
                      style={{
                        cursor: "pointer",
                        height: "100%",
                        borderLeft: urgent ? "3px solid var(--bad)" : "3px solid transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{a.label}</span>
                        {urgent && (
                          <span
                            className="pill warn"
                            style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}
                          >
                            Urgent
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{a.note}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
