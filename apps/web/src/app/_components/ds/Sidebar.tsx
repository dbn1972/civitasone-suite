"use client";
import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "./Avatar";
import {
  LayoutDashboard, Rocket, HelpCircle,
  Banknote, Receipt, FileText,
  Users, ShoppingCart, BarChart2, Gift, Building2, HardHat, Package,
  GraduationCap, BookOpen, CalendarDays, Target, ClipboardList, BadgeCheck,
  Handshake, Headphones, FolderOpen, Landmark, Puzzle, ShieldCheck, Scale, CalendarCheck, Search, Telescope, Castle,
  MapPin, Map, Satellite,
  ScanSearch, Gavel,
  Bot, Truck, Star, Archive, Dna, Compass, Sparkles,
  TrendingUp, BookMarked, ScrollText, MessageCircleQuestion, Bell, CreditCard, Building, Shield, Wrench,
  LucideIcon,
} from "lucide-react";

const COLLAPSED_KEY = "civitas-sidebar-collapsed";

type NavItem = {
  icon: LucideIcon;
  label: string;
  href: string;
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
      { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", moduleKey: null },
      { icon: Rocket, label: "Getting Started", href: "/setup", moduleKey: null },
      { icon: HelpCircle, label: "Help Centre", href: "/help", moduleKey: null },
    ],
  },
  {
    group: "FINANCE",
    items: [
      { icon: Banknote, label: "Finance", href: "/finance", moduleKey: "finance" },
      { icon: Receipt, label: "Revenue", href: "/revenue", moduleKey: "revenue" },
      { icon: FileText, label: "Billing", href: "/billing", moduleKey: "billing" },
    ],
  },
  {
    group: "OPERATIONS",
    items: [
      { icon: Users, label: "HR & Payroll", href: "/hr", moduleKey: "hrms" },
      { icon: ShoppingCart, label: "Procurement", href: "/procurement", moduleKey: "procurement" },
      { icon: BarChart2, label: "Projects", href: "/projects", moduleKey: "projects" },
      { icon: Gift, label: "Grants", href: "/grants", moduleKey: "grants" },
      { icon: Building2, label: "Establishment", href: "/estab", moduleKey: "establishment" },
      { icon: HardHat, label: "Assets", href: "/assets", moduleKey: "assets" },
      { icon: Package, label: "Stock", href: "/stock", moduleKey: "stock" },
    ],
  },
  {
    group: "LEARNING",
    items: [
      { icon: GraduationCap, label: "Catalogue", href: "/learning", moduleKey: "hrms" },
      { icon: BookOpen, label: "My Learning", href: "/learning/my-learning", moduleKey: "hrms" },
      { icon: CalendarDays, label: "Training Calendar", href: "/learning/calendar", moduleKey: "hrms" },
      { icon: Target, label: "Competencies", href: "/learning/competency", moduleKey: "hrms" },
      { icon: ClipboardList, label: "Assessments", href: "/learning/assessments", moduleKey: "hrms" },
      { icon: BadgeCheck, label: "Verify Certificate", href: "/learning/assessments/verify", moduleKey: "hrms" },
    ],
  },
  {
    group: "MUNICIPAL",
    items: [
      { icon: Castle, label: "Municipal Services", href: "/municipal", moduleKey: null },
    ],
  },
  {
    group: "CITIZEN SERVICES",
    items: [
      { icon: Handshake, label: "CRM", href: "/crm", moduleKey: "crm" },
      { icon: Headphones, label: "Helpdesk", href: "/helpdesk", moduleKey: "helpdesk" },
      { icon: FolderOpen, label: "Service Catalogue", href: "/helpdesk/catalogue", moduleKey: "helpdesk" },
      { icon: Landmark, label: "Citizen Portal", href: "/citizen", moduleKey: "citizen" },
      { icon: Puzzle, label: "Service Designer", href: "/designer", moduleKey: "citizen" },
      { icon: ShieldCheck, label: "Visitor Mgmt", href: "/visitor", moduleKey: "visitor" },
      { icon: CalendarCheck, label: "Meeting Mgmt", href: "/meeting", moduleKey: "meeting" },
      { icon: Gavel, label: "Court Mgmt", href: "/court", moduleKey: "court" },
      { icon: Search, label: "Inspection", href: "/inspection", moduleKey: "inspection" },
    ],
  },
  {
    group: "LOCATIONS & GIS",
    items: [
      { icon: MapPin, label: "Locations", href: "/locations", moduleKey: null },
      { icon: Map, label: "Map Viewer", href: "/locations/maps", moduleKey: null },
      { icon: Satellite, label: "Map Monitoring", href: "/locations/maps/monitoring", moduleKey: null },
    ],
  },
  {
    group: "GOVERNANCE",
    items: [
      { icon: ScanSearch, label: "Audit", href: "/audit", moduleKey: "audit" },
      { icon: Scale, label: "Legal", href: "/legal", moduleKey: "legal" },
    ],
  },
  {
    group: "CITIZEN EXPERIENCE",
    items: [
      { icon: Bot, label: "AI & Copilot", href: "/ai", moduleKey: "ai-agent" },
      { icon: Truck, label: "Field Ops", href: "/field", moduleKey: "field" },
      { icon: Star, label: "Loyalty", href: "/loyalty", moduleKey: "loyalty" },
      { icon: Archive, label: "Catalogue", href: "/catalogue", moduleKey: "catalogue" },
      { icon: Dna, label: "CDP", href: "/cdp", moduleKey: "cdp" },
      { icon: Compass, label: "Journeys", href: "/journeys", moduleKey: "journey" },
      { icon: Sparkles, label: "Recommendations", href: "/recommendations", moduleKey: "recommendation" },
    ],
  },
  {
    group: "PLATFORM",
    items: [
      { icon: TrendingUp, label: "Reports", href: "/reports", moduleKey: "reports" },
      { icon: BookMarked, label: "Knowledge", href: "/knowledge", moduleKey: "knowledge" },
      { icon: ScrollText, label: "Policies & SOPs", href: "/knowledge/policies", moduleKey: "knowledge" },
      { icon: MessageCircleQuestion, label: "FAQ", href: "/knowledge/faqs", moduleKey: "knowledge" },
      { icon: Bot, label: "Assistant", href: "/knowledge/assistant", moduleKey: "knowledge" },
      { icon: Bell, label: "Notifications", href: "/notifications", moduleKey: null },
      { icon: CreditCard, label: "Identity", href: "/identity", moduleKey: "identity" },
      { icon: Building, label: "Tenant", href: "/tenant", moduleKey: "tenant" },
      { icon: Shield, label: "Tenant Admin", href: "/tenant-admin", moduleKey: null },
      { icon: Wrench, label: "Change & Release", href: "/change", moduleKey: null },
    ],
  },
];

export type SidebarProps = {
  enabledModules?: string[] | null;
  userName?: string;
  userRole?: string;
};

export function Sidebar({ enabledModules, userName, userRole }: SidebarProps = {}) {
  const pathname = usePathname();
  const enabledSet = enabledModules ? new Set(enabledModules) : null;

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
      if (next.has(group)) next.delete(group); else next.add(group);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* noop */ }
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
          const hasActive = items.some(({ href }) => isActive(href));
          const actuallyCollapsed = isCollapsed && !hasActive;
          return (
            <div key={group} role="group" aria-label={group}>
              <button
                type="button"
                className="sb-grp"
                aria-expanded={!actuallyCollapsed}
                onClick={() => toggleGroup(group)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px" }}
              >
                <span>{group}</span>
                <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.5, transition: "transform 160ms", transform: actuallyCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
              </button>
              {!actuallyCollapsed && items.map(({ icon: Icon, label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className={"sb-item" + (isActive(href) ? " on" : "")}
                  aria-current={isActive(href) ? "page" : undefined}
                >
                  <span className="i" aria-hidden="true">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  {label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sb-foot">
        <Avatar name={userName ?? "User"} color="#00439C" />
        <div>
          <div className="nm">{userName ?? "User"}</div>
          <div className="rl">{userRole ?? "Staff"}</div>
        </div>
      </div>
    </aside>
  );
}
