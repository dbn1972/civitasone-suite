/**
 * Dashboard — authenticated root
 * Route group: (app) — requires JWT cookie
 * Renders role-based module tiles. Modules shown depend on tenant entitlements.
 */
import Link from "next/link";
import type { NavTile } from "@civitasone/types";
import { PageShell } from "../../_components/PageShell";

export default function DashboardPage() {
  const moduleTiles: NavTile[] = [
    { title: "Finance", href: "/finance", description: "Budgets, bills, payments, GL" },
    { title: "HR & Payroll", href: "/hr", description: "Employees, attendance, leave, payroll" },
    { title: "Procurement", href: "/procurement", description: "Indents, vendors, POs, GRN" },
    { title: "Projects", href: "/projects", description: "Projects, milestones, fund releases" },
    { title: "Grants", href: "/grants", description: "Grants, grantees, releases, UCs" },
    { title: "Establishment", href: "/estab", description: "Files, meetings, vehicles, compliance" },
    { title: "Assets", href: "/assets", description: "Fixed assets, maintenance, depreciation" },
    { title: "Stock & Inventory", href: "/stock", description: "SKUs, stock ledger, low stock alerts" },
    { title: "CRM", href: "/crm", description: "Contacts, deals, pipeline" },
    { title: "Helpdesk", href: "/helpdesk", description: "Tickets, SLA, escalations" },
    { title: "Citizen Portal", href: "/citizen", description: "Requests, RTI, feedback" },
    { title: "Audit", href: "/audit", description: "Observations, risk register, compliance" },
    { title: "Legal", href: "/legal", description: "Cases, hearings, court orders" },
    { title: "Reports", href: "/reports", description: "Analytics, KPIs, MIS" },
    { title: "Knowledge", href: "/knowledge", description: "Documents, records, search" },
    { title: "Notifications", href: "/notifications", description: "Alerts, deliveries, preferences" },
    { title: "Tenant Admin", href: "/tenant-admin", description: "Users, roles, settings, billing" },
  ];

  return (
    <PageShell title="Dashboard" description="Role-aware landing zone for enabled CivitasOne modules.">
        <div className="mt-6 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {moduleTiles.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-md transition-all"
            >
              <h3 className="font-semibold text-gray-900 text-sm">{tile.title}</h3>
              <p className="text-xs text-gray-500 mt-1">{tile.description}</p>
            </Link>
          ))}
        </div>
    </PageShell>
  );
}
