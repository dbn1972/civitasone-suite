"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./Avatar";

const NAV = [
  {
    group: "OVERVIEW",
    items: [{ icon: "🏠", label: "Dashboard", href: "/dashboard" }],
  },
  {
    group: "FINANCE",
    items: [{ icon: "🏦", label: "Finance", href: "/finance" }],
  },
  {
    group: "OPERATIONS",
    items: [
      { icon: "👥", label: "HR & Payroll", href: "/hr" },
      { icon: "🛒", label: "Procurement", href: "/procurement" },
      { icon: "📊", label: "Projects", href: "/projects" },
      { icon: "🎁", label: "Grants", href: "/grants" },
      { icon: "🏢", label: "Establishment", href: "/estab" },
      { icon: "🏗️", label: "Assets", href: "/assets" },
      { icon: "📦", label: "Stock", href: "/stock" },
    ],
  },
  {
    group: "CITIZEN SERVICES",
    items: [
      { icon: "🤝", label: "CRM", href: "/crm" },
      { icon: "🎧", label: "Helpdesk", href: "/helpdesk" },
      { icon: "🪪", label: "Citizen Portal", href: "/citizen" },
    ],
  },
  {
    group: "GOVERNANCE",
    items: [
      { icon: "🔍", label: "Audit", href: "/audit" },
      { icon: "⚖️", label: "Legal", href: "/legal" },
    ],
  },
  {
    group: "PLATFORM",
    items: [
      { icon: "📈", label: "Reports", href: "/reports" },
      { icon: "📚", label: "Knowledge", href: "/knowledge" },
      { icon: "🔔", label: "Notifications", href: "/notifications" },
      { icon: "🛡️", label: "Tenant Admin", href: "/tenant-admin" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside className="sb">
      <div className="sb-brand">
        <div className="sb-logo">◈</div>
        <div>
          <div className="sb-bn">CivitasOne</div>
          <div className="sb-bs">Enterprise Suite</div>
        </div>
      </div>
      <nav className="sb-nav">
        {NAV.map(({ group, items }) => (
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
