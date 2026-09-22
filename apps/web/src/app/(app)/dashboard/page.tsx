import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader, EmptyState, StatIcon } from "../../_components/ds";
import { RoleCommandCenter } from "./RoleCommandCenter";
import { FirstRunTour } from "./FirstRunTour";
import { ActivationTracker } from "../../_components/ActivationTracker";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

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
  return MODULES.filter((m) => m.roles.length === 0 || m.roles.some((prefix) => roles.some((r) => r.includes(prefix)))); // ux-001-ok: `m.roles` is a hardcoded property of the module-static MODULES array literal above, not fetched data -- no loader/source in this path
}

export default async function DashboardPage() {
  const t = await getTranslations("home");
  const roles = getSessionRoles();
  const modules = visibleModules(roles);

  return (
    <>
      <FirstRunTour />
      <ActivationTracker steps={["signin"]} />
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<Link href="/workflow" className="btn primary">{t("myApprovals")}</Link>}
      />
      <Link
        href="/setup"
        aria-label={t("setupBannerTitle")}
        style={{ textDecoration: "none", display: "block", marginBottom: 18 }}
      >
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            background: "var(--primary-soft)",
            border: "1px solid var(--goodbd)",
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 22 }}>🚀</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("setupBannerTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--ink2)" }}>{t("setupBannerDesc")}</div>
          </div>
          {/*
            An icon, not a "→" text glyph: axe's color-contrast rule cannot
            reliably measure contrast for decorative Unicode arrow characters
            and treats that as an undecided, blocking result (same pattern as
            PageHeader.tsx's back arrow). An SVG icon isn't subject to that
            text-contrast heuristic.
          */}
          <ArrowRight aria-hidden="true" size={14} style={{ color: "var(--primary-d)" }} />
        </div>
      </Link>
      <RoleCommandCenter />
      <section aria-labelledby="dash-modules-h">
        <div className="card-h" style={{ marginBottom: 12 }}>
          <h2 id="dash-modules-h" style={{ margin: 0, fontSize: 15 }}>{t("yourModules")}</h2>
        </div>
        {modules.length === 0 ? ( // ux-001-ok: `modules` is a synchronous filter of the hardcoded MODULES list against `getSessionRoles()` (a local JWT-cookie decode, not a network fetch) -- zero matches means the signed-in user's roles genuinely grant no module, never a fetch failure
          <div className="card">
            <div className="pad">
              <EmptyState
                icon="🧭"
                title={t("noModules")}
                message={t("noModulesMsg")}
              />
            </div>
          </div>
        ) : (
          <nav aria-label={t("yourModules")} className="grid g-4">
            {modules.map(({ icon, label, href, desc, bg }) => (
              <Link key={href} href={href} aria-label={label} style={{ textDecoration: "none", display: "block" }}>
                <div className="stat" style={{ cursor: "pointer", height: "100%" }}>
                  <div className="top">
                    <div />
                    <div className="ic" style={{ background: bg }} aria-hidden="true">
                      <StatIcon icon={icon} />
                    </div>
                  </div>
                  <div className="lab">{desc}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6, letterSpacing: "-0.3px", color: "var(--ink)" }}>
                    {label}
                  </div>
                </div>
              </Link>
            ))}
          </nav>
        )}
      </section>
    </>
  );
}
