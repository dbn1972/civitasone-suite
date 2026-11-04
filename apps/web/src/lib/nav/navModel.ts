/**
 * UAT-P3 (UX shell, S-02 / NAV-02 / NAV-03): the one navigation model the
 * Sidebar, the dashboard self-service card and the global-search page index
 * all read. Pure data + pure visibility logic (no React, no next/headers), so
 * client and server components can share it.
 *
 * Visibility = the same two gates the destination itself applies:
 *  1. moduleKey, matched with the lenient matcher that every module layout
 *     (ModuleGate) uses, lib/moduleMatch.ts, and
 *  2. rolesAllowed, copied from the destination layout/page guard (each list
 *     cites where it comes from). Unknown roles (null / undefined) show the
 *     entry, the long-standing advisory-hide convention, EXCEPT failClosed
 *     entries whose layout itself denies an empty roles claim
 *     (revenue/layout.tsx PermissionDenied, billing/layout.tsx requireAnyRole).
 *
 * The backend stays the authority; this only stops the nav offering a link
 * whose page would deny the user.
 *
 * Labels: `label` is the English fallback (used when no NextIntlClientProvider
 * is mounted, e.g. component tests). The translated label is the next-intl key
 * appNav.item.<id> / appNav.group.<id> (messages/en.json + hi.json).
 */
import { isModuleEnabled } from "@/lib/moduleMatch";
import {
  FINANCE_ROLES,
  HR_ROLES,
  HR_STAFF_MANAGER_ROLES,
  PAYROLL_EMPLOYEE_ROLES,
  PAYROLL_SALARY_ADMIN_ROLES,
  REVENUE_ROLES,
} from "@/lib/auth/workRoles";
import { PAYROLL_RUN_READER_ROLES } from "@/lib/auth/payrollRunRoles";
import { HR_TILE_ROLE_OVERRIDES } from "@/lib/auth/hrTileAccess";
import { IDENTITY_ADMIN_ROLES } from "@/lib/auth/identityRoles";
import { ADMIN_TENANT_ROLES, BILLING_GSTN_ROLES, BILLING_MODULE_ROLES } from "@/lib/auth/adminRoles";
import { MEETING_CONFIG_ADMIN_ROLES, MEETING_CREATE_ROLES } from "@/lib/auth/meetingRoles";
import { GRANTS_VIEW_ROLES } from "@/app/(app)/grants/roles";
import { TENANT_ADMIN_ROLES } from "@/app/(app)/tenant/_roles";

export type NavItemDef = {
  /** Stable id: React key, icon lookup and the appNav.item.<id> message key. */
  id: string;
  /** English fallback label. */
  label: string;
  href: string;
  moduleKey: string | null;
  rolesAllowed?: readonly string[];
  /** Hide when the roles claim is known to be empty, because the destination fails closed. */
  failClosed?: boolean;
};

export type NavGroupDef = {
  /** Stable id: appNav.group.<id>. */
  id: string;
  /** English fallback heading; also the persisted collapsed-group key. */
  label: string;
  items: NavItemDef[];
};

/** hr/layout.tsx admits HR_ROLES; the hub and staff screens are not for a plain employee. */
const HR_NON_EMPLOYEE_ROLES = HR_ROLES.filter((r) => r !== "employee");

const HR = "hrms";

/** The employee self-service menu (S-02). Also rendered as a dashboard card. */
export const SELF_SERVICE_ITEMS: NavItemDef[] = [
  // hr/layout.tsx HR_ROLES (the apply page has no narrower gate).
  { id: "myLeave", label: "My leave", href: "/hr/leave/apply", moduleKey: HR, rolesAllowed: HR_ROLES },
  // hr/payroll/my-slips/page.tsx PermissionDenied on PAYROLL_EMPLOYEE_ROLES.
  { id: "myPayslips", label: "My payslips", href: "/hr/payroll/my-slips", moduleKey: HR, rolesAllowed: PAYROLL_EMPLOYEE_ROLES },
  // hr/attendance/page.tsx: every HR_ROLES role gets the self check-in card.
  { id: "myAttendance", label: "My attendance", href: "/hr/attendance", moduleKey: HR, rolesAllowed: HR_ROLES },
  // hr/payroll/tax-declaration/page.tsx: own declaration for every HR_ROLES role.
  { id: "myTaxDeclaration", label: "My tax declaration", href: "/hr/payroll/tax-declaration", moduleKey: HR, rolesAllowed: HR_ROLES },
  // hr/service-book/page.tsx: "My Service Book" (postings, pay, leave record) of the signed-in employee.
  { id: "myProfile", label: "My profile", href: "/hr/service-book", moduleKey: HR, rolesAllowed: HR_ROLES },
];

export const NAV_GROUPS: NavGroupDef[] = [
  {
    id: "overview",
    label: "OVERVIEW",
    items: [
      { id: "dashboard", label: "Dashboard", href: "/dashboard", moduleKey: null },
      { id: "setup", label: "Getting Started", href: "/setup", moduleKey: null },
      { id: "help", label: "Help Centre", href: "/help", moduleKey: null },
    ],
  },
  { id: "selfService", label: "SELF-SERVICE", items: SELF_SERVICE_ITEMS },
  {
    id: "finance",
    label: "FINANCE",
    items: [
      { id: "finance", label: "Finance", href: "/finance", moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
    ],
  },
  {
    id: "hrPayroll",
    label: "HR & PAYROLL",
    items: [
      { id: "hr", label: "HR & Payroll", href: "/hr", moduleKey: HR, rolesAllowed: HR_NON_EMPLOYEE_ROLES },
      // hr/employees list (directory reading tier: HR staff + manager).
      { id: "hrEmployees", label: "Employees", href: "/hr/employees", moduleKey: HR, rolesAllowed: HR_STAFF_MANAGER_ROLES },
      // hr/leave/approvals/page.tsx PermissionDenied on HR_STAFF_MANAGER_ROLES.
      { id: "hrLeaveApprovals", label: "Leave approvals", href: "/hr/leave/approvals", moduleKey: HR, rolesAllowed: HR_STAFF_MANAGER_ROLES },
      // hr/payroll/page.tsx PermissionDenied on PAYROLL_RUN_READER_ROLES.
      { id: "hrPayrollRuns", label: "Payroll runs", href: "/hr/payroll", moduleKey: HR, rolesAllowed: PAYROLL_RUN_READER_ROLES },
      // hr/payroll/salary-slips/page.tsx SALARY_ADMIN_ROLES (the same list the HR hub tile uses).
      { id: "hrSalarySlips", label: "Salary slips", href: "/hr/payroll/salary-slips", moduleKey: HR, rolesAllowed: HR_TILE_ROLE_OVERRIDES["/hr/payroll/salary-slips"] },
      // hr/payroll/ddos/page.tsx PermissionDenied on PAYROLL_READER_ROLES (= PAYROLL_SALARY_ADMIN_ROLES).
      { id: "hrDdos", label: "DDOs", href: "/hr/payroll/ddos", moduleKey: HR, rolesAllowed: PAYROLL_SALARY_ADMIN_ROLES },
    ],
  },
  {
    id: "revenue",
    label: "REVENUE",
    // revenue/layout.tsx: PermissionDenied unless REVENUE_ROLES (fails closed), ModuleGate "revenue".
    items: [
      { id: "revenue", label: "Revenue", href: "/revenue", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
      { id: "revenueAssessees", label: "Assessees", href: "/revenue/assessees", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
      { id: "revenueAssessments", label: "Assessments", href: "/revenue/assessments", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
      { id: "revenueBills", label: "Demand bills", href: "/revenue/bills", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
      { id: "revenueReceipts", label: "Receipts", href: "/revenue/receipts", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
      { id: "revenueWaivers", label: "Waivers", href: "/revenue/waivers", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
      { id: "revenueTradeLicences", label: "Trade licences", href: "/revenue/trade-licenses", moduleKey: "revenue", rolesAllowed: REVENUE_ROLES, failClosed: true },
    ],
  },
  {
    id: "billing",
    label: "BILLING",
    // billing/layout.tsx: requireAnyRole(BILLING_MODULE_ROLES) (fails closed), ModuleGate "billing".
    items: [
      { id: "billing", label: "Billing", href: "/billing", moduleKey: "billing", rolesAllowed: BILLING_MODULE_ROLES, failClosed: true },
      { id: "billingInvoices", label: "Invoices", href: "/billing/invoices", moduleKey: "billing", rolesAllowed: BILLING_MODULE_ROLES, failClosed: true },
      { id: "billingPayments", label: "Payments received", href: "/billing/payments", moduleKey: "billing", rolesAllowed: BILLING_MODULE_ROLES, failClosed: true },
      { id: "billingSubscriptions", label: "Subscriptions", href: "/billing/subscriptions", moduleKey: "billing", rolesAllowed: BILLING_MODULE_ROLES, failClosed: true },
      // billing/gstn/layout.tsx narrows to BILLING_GSTN_ROLES.
      { id: "billingGstn", label: "GST returns", href: "/billing/gstn", moduleKey: "billing", rolesAllowed: BILLING_GSTN_ROLES, failClosed: true },
    ],
  },
  {
    id: "operations",
    label: "OPERATIONS",
    items: [
      { id: "procurement", label: "Procurement", href: "/procurement", moduleKey: "procurement" },
      // GAP-CONTRACTS-HOME-02: same moduleKey as the contracts/layout.tsx ModuleGate.
      { id: "contracts", label: "Contracts", href: "/contracts", moduleKey: "contracts" },
      { id: "projects", label: "Projects", href: "/projects", moduleKey: "projects" },
      { id: "grants", label: "Grants", href: "/grants", moduleKey: "grants", rolesAllowed: GRANTS_VIEW_ROLES },
      { id: "establishment", label: "Establishment", href: "/estab", moduleKey: "establishment" },
      { id: "documents", label: "Documents", href: "/documents", moduleKey: "documents" },
      { id: "assets", label: "Assets", href: "/assets", moduleKey: "assets" },
      // GAP-FLEET-HOME-03: /fleet is gated on the "assets" module (fleet/layout.tsx).
      { id: "fleet", label: "Fleet", href: "/fleet", moduleKey: "assets" },
      { id: "stock", label: "Stock", href: "/stock", moduleKey: "stock" },
    ],
  },
  {
    id: "meetings",
    label: "MEETINGS",
    // meeting/layout.tsx: ModuleGate "meeting" only; sub-pages narrow as cited.
    items: [
      { id: "meeting", label: "Meetings", href: "/meeting", moduleKey: "meeting" },
      { id: "meetingList", label: "All meetings", href: "/meeting/meetings", moduleKey: "meeting" },
      // POST /v1/meetings is MEETING_CREATE_ROLES (the list hides "+ New meeting" for everyone else).
      { id: "meetingNew", label: "Schedule a meeting", href: "/meeting/meetings/new", moduleKey: "meeting", rolesAllowed: MEETING_CREATE_ROLES },
      // meeting/admin/page.tsx requireAnyRole(MEETING_CONFIG_ADMIN_ROLES).
      { id: "meetingAdmin", label: "Meeting settings", href: "/meeting/admin", moduleKey: "meeting", rolesAllowed: MEETING_CONFIG_ADMIN_ROLES },
    ],
  },
  {
    id: "learning",
    label: "LEARNING",
    items: [
      { id: "learningCatalogue", label: "Catalogue", href: "/learning", moduleKey: HR },
      { id: "myLearning", label: "My Learning", href: "/learning/my-learning", moduleKey: HR },
      { id: "trainingCalendar", label: "Training Calendar", href: "/learning/calendar", moduleKey: HR },
      { id: "competencies", label: "Competencies", href: "/learning/competency", moduleKey: HR },
      { id: "assessments", label: "Assessments", href: "/learning/assessments", moduleKey: HR },
      { id: "verifyCertificate", label: "Verify Certificate", href: "/learning/assessments/verify", moduleKey: HR },
    ],
  },
  {
    id: "municipal",
    label: "MUNICIPAL",
    items: [{ id: "municipal", label: "Municipal Services", href: "/municipal", moduleKey: null }],
  },
  {
    id: "citizenServices",
    label: "CITIZEN SERVICES",
    items: [
      { id: "crm", label: "CRM", href: "/crm", moduleKey: "crm" },
      { id: "helpdesk", label: "Helpdesk", href: "/helpdesk", moduleKey: "helpdesk" },
      { id: "serviceCatalogue", label: "Service Catalogue", href: "/helpdesk/catalogue", moduleKey: "helpdesk" },
      { id: "citizen", label: "Citizen Portal", href: "/citizen", moduleKey: "citizen" },
      { id: "designer", label: "Service Designer", href: "/designer", moduleKey: "designer" },
      // GAP-WORKFLOW-LIST-05 / GAP-WORKFLOW-MY-TASKS-07.
      { id: "workflow", label: "Workflow", href: "/workflow", moduleKey: "workflow" },
      { id: "visitor", label: "Visitor Mgmt", href: "/visitor", moduleKey: "visitor" },
      { id: "court", label: "Court Mgmt", href: "/court", moduleKey: "court" },
      { id: "inspection", label: "Inspection", href: "/inspection", moduleKey: "inspection" },
      // GAP-TELEPHONY-HOME-01: moduleKey matches the telephony/layout.tsx ModuleGate.
      { id: "telephony", label: "Telephony", href: "/telephony", moduleKey: "telephony" },
    ],
  },
  {
    id: "locations",
    label: "LOCATIONS & GIS",
    items: [
      { id: "locations", label: "Locations", href: "/locations", moduleKey: null },
      { id: "mapViewer", label: "Map Viewer", href: "/locations/maps", moduleKey: null },
      { id: "mapMonitoring", label: "Map Monitoring", href: "/locations/maps/monitoring", moduleKey: null },
    ],
  },
  {
    id: "governance",
    label: "GOVERNANCE",
    items: [
      { id: "audit", label: "Audit", href: "/audit", moduleKey: "audit" },
      { id: "legal", label: "Legal", href: "/legal", moduleKey: "legal" },
    ],
  },
  {
    id: "citizenExperience",
    label: "CITIZEN EXPERIENCE",
    items: [
      { id: "ai", label: "AI & Copilot", href: "/ai", moduleKey: "ai-agent" },
      { id: "field", label: "Field Ops", href: "/field", moduleKey: "field" },
      { id: "loyalty", label: "Loyalty", href: "/loyalty", moduleKey: "loyalty" },
      { id: "catalogue", label: "Catalogue", href: "/catalogue", moduleKey: "catalogue" },
      { id: "cdp", label: "CDP", href: "/cdp", moduleKey: "cdp" },
      { id: "journeys", label: "Journeys", href: "/journeys", moduleKey: "journey" },
      { id: "recommendations", label: "Recommendations", href: "/recommendations", moduleKey: "recommendation" },
    ],
  },
  {
    id: "platform",
    label: "PLATFORM",
    items: [
      { id: "reports", label: "Reports", href: "/reports", moduleKey: "reports" },
      { id: "knowledge", label: "Knowledge", href: "/knowledge", moduleKey: "knowledge" },
      { id: "policies", label: "Policies & SOPs", href: "/knowledge/policies", moduleKey: "knowledge" },
      { id: "faq", label: "FAQ", href: "/knowledge/faqs", moduleKey: "knowledge" },
      { id: "assistant", label: "Assistant", href: "/knowledge/assistant", moduleKey: "knowledge" },
      { id: "notifications", label: "Notifications", href: "/notifications", moduleKey: null },
      { id: "identity", label: "Identity", href: "/identity", moduleKey: "identity", rolesAllowed: IDENTITY_ADMIN_ROLES },
      { id: "tenant", label: "Tenant", href: "/tenant", moduleKey: "tenant", rolesAllowed: TENANT_ADMIN_ROLES },
      // GAP-ADMIN-HOME-04: the /admin hub admits tenant_admin and above.
      { id: "administration", label: "Administration", href: "/admin", moduleKey: null, rolesAllowed: ADMIN_TENANT_ROLES },
      { id: "tenantAdmin", label: "Tenant Admin", href: "/tenant-admin", moduleKey: null, rolesAllowed: ADMIN_TENANT_ROLES },
      { id: "change", label: "Change & Release", href: "/change", moduleKey: null, rolesAllowed: ADMIN_TENANT_ROLES },
    ],
  },
];

export type NavAccess = {
  /** Tenant module keys; null/undefined = unknown (show all). */
  enabledModules?: readonly string[] | null;
  /**
   * JWT roles claim. null/undefined = unknown (advisory show). An explicit []
   * is a session with no roles: shown except failClosed entries.
   */
  roles?: readonly string[] | null;
};

/** True when the user can open the item (the same gates as its destination). */
export function isNavItemVisible(
  item: Pick<NavItemDef, "moduleKey" | "rolesAllowed" | "failClosed">,
  access: NavAccess = {},
): boolean {
  const roles = access.roles ?? null;
  if (item.rolesAllowed && roles) {
    if (roles.length > 0) {
      if (!roles.some((r) => item.rolesAllowed!.includes(r))) return false;
    } else if (item.failClosed) {
      return false;
    }
  }
  const enabled = access.enabledModules ? [...access.enabledModules] : null;
  // platformAlwaysOn:false keeps the long-standing sidebar rule that platform
  // entries (Documents, Workflow) follow the tenant module list.
  return isModuleEnabled(enabled, item.moduleKey, roles ? [...roles] : undefined, { platformAlwaysOn: false });
}

/** Groups with only the items the user can open; empty groups dropped. */
export function visibleNavGroups(access: NavAccess = {}, groups: NavGroupDef[] = NAV_GROUPS): NavGroupDef[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => isNavItemVisible(i, access)) }))
    .filter((g) => g.items.length > 0);
}

/** The most specific href that contains `pathname`: one active entry, not every ancestor. */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}
