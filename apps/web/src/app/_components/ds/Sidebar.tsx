"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./Avatar";

type NavItem = {
  icon: string;
  label: string;
  href: string;
  /** Module key for enablement gating. null = always visible (platform/overview). */
  moduleKey: string | null;
};

type NavGroup = {
  group: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    group: "OVERVIEW",
    items: [
      { icon: "🏠", label: "Dashboard", href: "/dashboard", moduleKey: null },
      { icon: "🚀", label: "Getting Started", href: "/setup", moduleKey: null },
      { icon: "❓", label: "Help Centre", href: "/help", moduleKey: null },
    ],
  },
  {
    group: "FINANCE",
    items: [{ icon: "🏦", label: "Finance", href: "/finance", moduleKey: "finance" }, { icon: "🧾", label: "Revenue", href: "/revenue", moduleKey: "revenue" }, { icon: "📑", label: "Billing", href: "/billing", moduleKey: "billing" }],
  },
  {
    group: "OPERATIONS",
    items: [
      { icon: "👥", label: "HR & Payroll", href: "/hr", moduleKey: "hrms" },
      { icon: "🛒", label: "Procurement", href: "/procurement", moduleKey: "procurement" },
      { icon: "📊", label: "Projects", href: "/projects", moduleKey: "projects" },
      { icon: "🎁", label: "Grants", href: "/grants", moduleKey: "grants" },
      { icon: "🏢", label: "Establishment", href: "/estab", moduleKey: "establishment" },
      { icon: "🏗️", label: "Assets", href: "/assets", moduleKey: "assets" },
      { icon: "📦", label: "Stock", href: "/stock", moduleKey: "stock" },
    ],
  },
  {
    group: "LEARNING",
    items: [
      { icon: "🎓", label: "Catalogue", href: "/learning", moduleKey: "hrms" },
      { icon: "📚", label: "My Learning", href: "/learning/my-learning", moduleKey: "hrms" },
      { icon: "📅", label: "Training Calendar", href: "/learning/calendar", moduleKey: "hrms" },
      { icon: "🎯", label: "Competencies", href: "/learning/competency", moduleKey: "hrms" },
      { icon: "📝", label: "Assessments", href: "/learning/assessments", moduleKey: "hrms" },
      { icon: "🔖", label: "Verify Certificate", href: "/learning/assessments/verify", moduleKey: "hrms" },
    ],
  },
  {
    group: "CITIZEN SERVICES",
    items: [
      { icon: "🤝", label: "CRM", href: "/crm", moduleKey: "crm" },
      { icon: "🎧", label: "Helpdesk", href: "/helpdesk", moduleKey: "helpdesk" },
      { icon: "🗂️", label: "Service Catalogue", href: "/helpdesk/catalogue", moduleKey: "helpdesk" },
      { icon: "🪪", label: "Citizen Portal", href: "/citizen", moduleKey: "citizen" },
      { icon: "🛂", label: "Visitor Mgmt", href: "/visitor", moduleKey: "visitor" },
      { icon: "⚖️", label: "Meeting Mgmt", href: "/meeting", moduleKey: "meeting" },
      { icon: "🏛️", label: "Court Mgmt", href: "/court", moduleKey: "court" },
    ],
  },
  {
    group: "LOCATIONS & GIS",
    items: [
      { icon: "📍", label: "Locations", href: "/locations", moduleKey: null },
      { icon: "🗺️", label: "Map Viewer", href: "/locations/maps", moduleKey: null },
      { icon: "🛰️", label: "Map Monitoring", href: "/locations/maps/monitoring", moduleKey: null },
    ],
  },
  {
    group: "GOVERNANCE",
    items: [
      { icon: "🔍", label: "Audit", href: "/audit", moduleKey: "audit" },
      { icon: "⚖️", label: "Legal", href: "/legal", moduleKey: "legal" },
    ],
  },
  {
    group: "PLATFORM",
    items: [
      { icon: "📈", label: "Reports", href: "/reports", moduleKey: "reports" },
      { icon: "📚", label: "Knowledge", href: "/knowledge", moduleKey: "knowledge" },
      { icon: "📋", label: "Policies & SOPs", href: "/knowledge/policies", moduleKey: "knowledge" },
      { icon: "❔", label: "FAQ", href: "/knowledge/faqs", moduleKey: "knowledge" },
      { icon: "🤖", label: "Assistant", href: "/knowledge/assistant", moduleKey: "knowledge" },
      { icon: "🔔", label: "Notifications", href: "/notifications", moduleKey: null },
      { icon: "🛡️", label: "Tenant Admin", href: "/tenant-admin", moduleKey: null },
      { icon: "🔧", label: "Change & Release", href: "/change", moduleKey: null },
    ],
  },
];

export type SidebarProps = {
  /**
   * List of enabled module keys for the current tenant.
   * If undefined/null, all items are shown (backwards compatible — no filtering).
   */
  enabledModules?: string[] | null;
};

export function Sidebar({ enabledModules }: SidebarProps = {}) {
  const pathname = usePathname();
  const enabledSet = enabledModules ? new Set(enabledModules) : null;

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function isVisible(item: NavItem): boolean {
    // No enabledModules data → show everything (backwards compatible)
    if (!enabledSet) return true;
    // Items without a moduleKey are always visible (platform/overview)
    if (item.moduleKey === null) return true;
    // Otherwise, only show if the module is enabled
    return enabledSet.has(item.moduleKey);
  }

  // Filter groups: only render a group if it has at least one visible item
  const visibleNav = NAV.map(({ group, items }) => ({
    group,
    items: items.filter(isVisible),
  })).filter(({ items }) => items.length > 0);

  return (
    <aside className="sb">
      <div className="sb-brand">
        <div className="sb-logo" aria-hidden="true">◈</div>
        <div>
          <div className="sb-bn">CivitasOne</div>
          <div className="sb-bs">Enterprise Suite</div>
        </div>
      </div>
      <nav className="sb-nav">
        {visibleNav.map(({ group, items }) => (
          <div key={group}>
            <div className="sb-grp">{group}</div>
            {items.map(({ icon, label, href }) => (
              <Link
                key={href}
                href={href}
                className={"sb-item" + (isActive(href) ? " on" : "")}
              >
                <span className="i">{icon}</span>
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sb-foot">
        <Avatar name="D Nayak" color="#4f46e5" />
        <div>
          <div className="nm">D. Nayak</div>
          <div className="rl">Admin</div>
        </div>
      </div>
    </aside>
  );
}
