import Link from "next/link";
import { PageHeader } from "../../_components/ds";
import { RoleCommandCenter } from "./RoleCommandCenter";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const MODULES = [
  { icon: "🏦", label: "Finance", href: "/finance", desc: "Budgets, bills, payments, GL", bg: "#eef2ff", roles: ["finance"] },
  { icon: "👥", label: "HR & Payroll", href: "/hr", desc: "Employees, attendance, leave, payroll", bg: "#f0fdf4", roles: ["hr", "payroll"] },
  { icon: "🛒", label: "Procurement", href: "/procurement", desc: "Indents, vendors, POs, GRN", bg: "#fff7ed", roles: ["procurement"] },
  { icon: "📊", label: "Projects", href: "/projects", desc: "Projects, milestones, fund releases", bg: "#eff6ff", roles: ["project"] },
  { icon: "🎁", label: "Grants", href: "/grants", desc: "Grants, grantees, releases, UCs", bg: "#fef3f2", roles: ["grant"] },
  { icon: "🏢", label: "Establishment", href: "/estab", desc: "Files, meetings, vehicles, compliance", bg: "#f5f3ff", roles: ["estab"] },
  { icon: "🏗️", label: "Assets", href: "/assets", desc: "Fixed assets, maintenance, depreciation", bg: "#fff7ed", roles: ["asset"] },
  { icon: "📦", label: "Stock", href: "/stock", desc: "SKUs, stock ledger, low stock alerts", bg: "#ecfdf5", roles: ["stock", "inventory"] },
  { icon: "🤝", label: "CRM", href: "/crm", desc: "Contacts, deals, pipeline", bg: "#fdf4ff", roles: ["crm", "sales"] },
  { icon: "🎧", label: "Helpdesk", href: "/helpdesk", desc: "Tickets, SLA, escalations", bg: "#f0f9ff", roles: ["helpdesk"] },
  { icon: "🪪", label: "Citizen Portal", href: "/citizen", desc: "Requests, RTI, feedback", bg: "#ecfdf5", roles: ["citizen"] },
  { icon: "🔍", label: "Audit", href: "/audit", desc: "Observations, risk register, compliance", bg: "#fff1f2", roles: ["audit"] },
  { icon: "⚖️", label: "Legal", href: "/legal", desc: "Cases, hearings, court orders", bg: "#faf5ff", roles: ["legal"] },
  { icon: "📈", label: "Reports", href: "/reports", desc: "Analytics, KPIs, MIS", bg: "#eff6ff", roles: [] },
  { icon: "📚", label: "Knowledge", href: "/knowledge", desc: "Documents, records, search", bg: "#fff7ed", roles: [] },
  { icon: "🔔", label: "Notifications", href: "/notifications", desc: "Alerts, deliveries, preferences", bg: "#f0f9ff", roles: [] },
  { icon: "🛡️", label: "Tenant Admin", href: "/tenant-admin", desc: "Users, roles, settings, billing", bg: "#f5f3ff", roles: ["admin", "tenant"] },
];

function visibleModules(roles: string[]) {
  if (roles.includes("super_admin")) return MODULES;
  return MODULES.filter((m) => m.roles.length === 0 || m.roles.some((prefix) => roles.some((r) => r.includes(prefix))));
}

export default function DashboardPage() {
  const roles = getSessionRoles();
  const modules = visibleModules(roles);

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle="What is happening, what needs action, and what to do next — filtered to your role."
        actions={<Link href="/workflow" className="btn primary">My approvals</Link>}
      />
      <RoleCommandCenter />
      <div className="card-h" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Your modules</h3>
      </div>
      <div className="grid g-4">
        {modules.map(({ icon, label, href, desc, bg }) => (
          <Link key={href} href={href} style={{ textDecoration: "none", display: "block" }}>
            <div className="stat" style={{ cursor: "pointer", height: "100%" }}>
              <div className="top">
                <div />
                <div className="ic" style={{ background: bg }}>{icon}</div>
              </div>
              <div className="lab">{desc}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6, letterSpacing: "-0.3px", color: "var(--ink)" }}>
                {label}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
