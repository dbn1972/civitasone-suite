"use client";
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar } from "./Avatar";
import {
  LayoutDashboard, Rocket, HelpCircle, Banknote, Receipt, FileText, Users, ShoppingCart, BarChart2, Gift,
  Building2, HardHat, Package, GraduationCap, BookOpen, CalendarDays, Target, ClipboardList, BadgeCheck,
  Handshake, Headphones, FolderOpen, Landmark, Puzzle, ShieldCheck, Scale, CalendarCheck, Search, Castle,
  PhoneCall, MapPin, Map, Satellite, ScanSearch, Gavel, GitBranch, Bot, Truck, Star, Archive, Dna, Compass,
  Sparkles, TrendingUp, BookMarked, ScrollText, MessageCircleQuestion, Bell, CreditCard, Building, Shield,
  Wrench, Diamond, ChevronDown, FileSignature, CalendarPlus, Clock, Wallet, UserRound, FileSpreadsheet,
  ListChecks, Settings, IdCard, Coins, ReceiptText, Stamp, Percent, Inbox,
  type LucideIcon,
} from "lucide-react";
import { NAV_GROUPS, activeNavHref, visibleNavGroups } from "@/lib/nav/navModel";
import { useShellT } from "../useShellT";
import { ApprovalsBadge } from "./ApprovalsBadge";

const COLLAPSED_KEY = "civitas-sidebar-collapsed";

/**
 * GAP-DASHBOARD-HOME-2-05: the Dashboard entry keeps the `nav.dashboard` key
 * (the same key the /dashboard page title reads), so nav and title agree.
 * Provider-optional, like useShellT: plain English without a provider.
 */
function useDashboardLabel(): (fallback: string) => string {
  try {
    const t = useTranslations("nav");
    return () => t("dashboard");
  } catch {
    return (fallback) => fallback;
  }
}

/** UX R1: the Approvals entry uses the inbox page title (en/hi); same provider-less fallback as above. */
function useApprovalsNavLabel(): string | null {
  try {
    return useTranslations("approvalsInbox")("title");
  } catch {
    return null;
  }
}

/** Icon per nav item id (lib/nav/navModel.ts). Unknown ids fall back to a document icon. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, setup: Rocket, help: HelpCircle, approvals: Inbox,
  myLeave: CalendarPlus, myPayslips: Wallet, myAttendance: Clock, myTaxDeclaration: FileSpreadsheet, myProfile: UserRound,
  finance: Banknote,
  hr: Users, hrEmployees: IdCard, hrLeaveApprovals: ListChecks, hrPayrollRuns: Coins, hrSalarySlips: ReceiptText, hrDdos: Stamp,
  revenue: Receipt, revenueAssessees: Users, revenueAssessments: ClipboardList, revenueBills: FileText,
  revenueReceipts: ReceiptText, revenueWaivers: Percent, revenueTradeLicences: BadgeCheck,
  billing: FileText, billingInvoices: ReceiptText, billingPayments: CreditCard, billingSubscriptions: CalendarCheck, billingGstn: Landmark,
  procurement: ShoppingCart, contracts: FileSignature, projects: BarChart2, grants: Gift, establishment: Building2,
  documents: FileText, assets: HardHat, fleet: Truck, stock: Package,
  meeting: CalendarCheck, meetingList: CalendarDays, meetingNew: CalendarPlus, meetingAdmin: Settings,
  learningCatalogue: GraduationCap, myLearning: BookOpen, trainingCalendar: CalendarDays, competencies: Target,
  assessments: ClipboardList, verifyCertificate: BadgeCheck,
  municipal: Castle,
  crm: Handshake, helpdesk: Headphones, serviceCatalogue: FolderOpen, citizen: Landmark, designer: Puzzle,
  workflow: GitBranch, visitor: ShieldCheck, court: Gavel, inspection: Search, telephony: PhoneCall,
  locations: MapPin, mapViewer: Map, mapMonitoring: Satellite,
  audit: ScanSearch, legal: Scale,
  ai: Bot, field: Truck, loyalty: Star, catalogue: Archive, cdp: Dna, journeys: Compass, recommendations: Sparkles,
  reports: TrendingUp, knowledge: BookMarked, policies: ScrollText, faq: MessageCircleQuestion, assistant: Bot,
  notifications: Bell, identity: CreditCard, tenant: Building, administration: ShieldCheck, tenantAdmin: Shield, change: Wrench,
};

/** English role labels the app layout passes (ROLE_LABELS in (app)/layout.tsx) mapped to appNav.role.<key>. */
const ROLE_LABEL_KEYS: Record<string, string> = {
  "Super Admin": "superAdmin", "Tenant Admin": "tenantAdmin", "Finance Admin": "financeAdmin",
  "Finance Staff": "financeStaff", "HR Admin": "hrAdmin", "HR Staff": "hrStaff", "Procurement": "procurement",
  "Auditor": "auditor", "Viewer": "viewer", "Staff": "staff",
};

export type SidebarProps = {
  enabledModules?: string[] | null;
  userName?: string;
  userRole?: string;
  /** Real JWT roles claim (not the single display label `userRole` is): hides entries the user cannot open. */
  roles?: string[] | null;
};

export function Sidebar({ enabledModules, userName, userRole, roles }: SidebarProps = {}) {
  const pathname = usePathname() ?? "";
  const t = useShellT("appNav");
  const dashboardLabel = useDashboardLabel();
  const approvalsLabel = useApprovalsNavLabel();

  // Server-safe default: always start expanded (an empty collapsed set),
  // matching what the server rendered. Reading localStorage in the initializer
  // would run during the hydration render too and mismatch the server tree, so
  // the persisted state is applied in an effect (same pattern as DarkModeToggle).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored) setCollapsed(new Set(JSON.parse(stored) as string[]));
    } catch {
      /* noop */
    }
  }, []);

  const toggleGroup = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }, []);

  // UAT-P3 (S-02): one model, the same module + role gates as each destination
  // (lib/nav/navModel.ts). Unknown roles/modules keep the "show" convention.
  const visibleNav = visibleNavGroups({ enabledModules, roles }, NAV_GROUPS);
  // Only the most specific matching entry is current (My leave, not also HR & Payroll).
  const activeHref = activeNavHref(pathname, visibleNav.flatMap((g) => g.items.map((i) => i.href)));

  const itemLabel = (id: string, fallback: string) =>
    id === "dashboard" ? dashboardLabel(fallback)
      : id === "approvals" ? (approvalsLabel ?? fallback)
      : t(`item.${id}`, fallback);
  const roleKey = userRole ? ROLE_LABEL_KEYS[userRole] : undefined;
  const roleLabel = userRole
    ? (roleKey ? t(`role.${roleKey}`, userRole) : userRole)
    : t("role.staff", "Staff");

  return (
    <aside id="app-sidebar" className="sb">
      <div className="sb-brand">
        {/*
          Diamond icon, not a text glyph: axe cannot measure contrast for
          decorative Unicode symbols ("nonBmp") and reports them as undecided.
        */}
        <div className="sb-logo" aria-hidden="true"><Diamond size={18} color="#fff" /></div>
        <div>
          <div className="sb-bn">CivitasOne</div>
          <div className="sb-bs">{t("brandSubtitle", "Enterprise Suite")}</div>
        </div>
      </div>
      <nav className="sb-nav" aria-label={t("mainNav", "Main navigation")}>
        {visibleNav.map(({ id: groupId, label: groupLabel, items }) => {
          // The persisted collapsed key stays the English heading (stored state survives a language switch).
          const isCollapsed = collapsed.has(groupLabel);
          const hasActive = items.some(({ href }) => href === activeHref);
          const actuallyCollapsed = isCollapsed && !hasActive;
          const heading = t(`group.${groupId}`, groupLabel);
          return (
            <div key={groupId} role="group" aria-label={heading}>
              <button
                type="button"
                className="sb-grp"
                aria-expanded={!actuallyCollapsed}
                onClick={() => toggleGroup(groupLabel)}
                style={{ width: "100%", textAlign: "start", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px" }}
              >
                <span>{heading}</span>
                {/* ChevronDown icon, not a text glyph (axe nonBmp, see above). */}
                <span aria-hidden="true" style={{ display: "inline-flex", opacity: 0.5, transition: "transform 160ms", transform: actuallyCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                  <ChevronDown size={12} />
                </span>
              </button>
              {!actuallyCollapsed && items.map(({ id, label, href }) => {
                const Icon = ICONS[id] ?? FileText;
                const on = href === activeHref;
                return (
                  <Link
                    key={id}
                    href={href}
                    className={"sb-item" + (on ? " on" : "")}
                    aria-current={on ? "page" : undefined}
                  >
                    <span className="i" aria-hidden="true">
                      <Icon size={16} strokeWidth={1.75} />
                    </span>
                    {itemLabel(id, label)}
                    {id === "approvals" && <ApprovalsBadge />}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="sb-foot">
        <Avatar name={userName ?? t("userFallback", "User")} color="#00439C" />
        <div>
          <div className="nm">{userName ?? t("userFallback", "User")}</div>
          <div className="rl">{roleLabel}</div>
        </div>
      </div>
    </aside>
  );
}
