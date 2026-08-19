"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./Avatar";

const COLLAPSED_KEY = "civitas-sidebar-collapsed";

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
      { icon: "🧩", label: "Service Designer", href: "/designer", moduleKey: "citizen" },
      { icon: "🛂", label: "Visitor Mgmt", href: "/visitor", moduleKey: "visitor" },
      { icon: "⚖️", label: "Meeting Mgmt", href: "/meeting", moduleKey: "meeting" },
      { icon: "🏛️", label: "Court Mgmt", href: "/court", moduleKey: "court" },
      { icon: "🔎", label: "Inspection", href: "/inspection", moduleKey: "inspection" },
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
    group: "CITIZEN EXPERIENCE",
    items: [
      { icon: "🤖", label: "AI & Copilot", href: "/ai", moduleKey: "ai-agent" },
      { icon: "🚐", label: "Field Ops", href: "/field", moduleKey: "field" },
      { icon: "🎁", label: "Loyalty", href: "/loyalty", moduleKey: "loyalty" },
      { icon: "📦", label: "Catalogue", href: "/catalogue", moduleKey: "catalogue" },
      { icon: "🧬", label: "CDP", href: "/cdp", moduleKey: "cdp" },
      { icon: "🧭", label: "Journeys", href: "/journeys", moduleKey: "journey" },
      { icon: "✨", label: "Recommendations", href: "/recommendations", moduleKey: "recommendation" },
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
      { icon: "🪪", label: "Identity", href: "/identity", moduleKey: "identity" },
      { icon: "🏢", label: "Tenant", href: "/tenant", moduleKey: "tenant" },
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
  /** Display name for the logged-in user shown in the sidebar footer. */
  userName?: string;
  /** Role label shown beneath the user name in the sidebar footer. */
  userRole?: string;
};

export function Sidebar({ enabledModules, userName, userRole }: SidebarProps = {}) {
  const pathname = usePathname();
  const enabledSet = enabledModules ? new Set(enabledModules) : null;

  // Persisted collapsed state per group label
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggleGroup = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function isVisible(item: NavItem): boolean {
    if (!enabledSet) return true;
    if (item.moduleKey === null) return true;
    return enabledSet.has(item.moduleKey);
  }

  const visibleNav = NAV.map(({ group, items }) => ({
    group,
    items: items.filter(isVisible),
  })).filter(({ items }) => items.length > 0);

  return (
    <aside id="app-sidebar" className="sb">
      <div className="sb-brand">
        <div className="sb-logo" aria-hidden="true">◈</div>
        <div>
          <div className="sb-bn">CivitasOne</div>
          <div className="sb-bs">Enterprise Suite</div>
        </div>
      </div>
      <nav className="sb-nav" aria-label="Main navigation">
        {visibleNav.map(({ group, items }) => {
          const isCollapsed = collapsed.has(group);
          // Never collapse a group that contains the active page
          const hasActive = items.some(({ href }) => isActive(href));
          const actuallyCollapsed = isCollapsed && !hasActive;
          return (
            <div key={group} role="group" aria-label={group}>
              <button
                type="button"
                className="sb-grp"
                aria-expanded={!actuallyCollapsed}
                onClick={() => toggleGroup(group)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 10px",
                }}
              >
                <span>{group}</span>
                <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.5, transition: "transform 160ms", transform: actuallyCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
              </button>
              {!actuallyCollapsed && items.map(({ icon, label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className={"sb-item" + (isActive(href) ? " on" : "")}
                  aria-current={isActive(href) ? "page" : undefined}
                >
                  <span className="i" aria-hidden="true">{icon}</span>
                  {label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sb-foot">
        <Avatar name={userName ?? "User"} color="#4f46e5" />
        <div>
          <div className="nm">{userName ?? "User"}</div>
          <div className="rl">{userRole ?? "Staff"}</div>
        </div>
      </div>
    </aside>
  );
}
