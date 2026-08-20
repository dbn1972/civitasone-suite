"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Human-readable label overrides for URL segments. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  finance: "Finance",
  hr: "HR & Payroll",
  crm: "CRM",
  helpdesk: "Helpdesk",
  procurement: "Procurement",
  projects: "Projects",
  grants: "Grants",
  estab: "Establishment",
  assets: "Assets",
  stock: "Stock",
  audit: "Audit",
  legal: "Legal",
  reports: "Reports",
  knowledge: "Knowledge",
  notifications: "Notifications",
  learning: "Learning",
  billing: "Billing",
  revenue: "Revenue",
  works: "Works",
  citizen: "Citizen Portal",
  helpdesk: "Helpdesk",
  visitor: "Visitor Mgmt",
  meeting: "Meeting Mgmt",
  court: "Court Mgmt",
  inspection: "Inspection",
  locations: "Locations",
  ai: "AI & Copilot",
  field: "Field Ops",
  loyalty: "Loyalty",
  catalogue: "Catalogue",
  cdp: "CDP",
  journeys: "Journeys",
  recommendations: "Recommendations",
  identity: "Identity",
  tenant: "Tenant",
  "tenant-admin": "Tenant Admin",
  change: "Change & Release",
  setup: "Getting Started",
  help: "Help Centre",
  analytics: "Analytics",
  workflow: "Workflow",
  admin: "Admin",
  // HR sub-routes
  employees: "Employees",
  attendance: "Attendance",
  leave: "Leave",
  payroll: "Payroll",
  recruitment: "Recruitment",
  appraisals: "Appraisals",
  training: "Training",
  orgchart: "Org Chart",
  // Finance sub-routes
  budget: "Budget",
  expenditure: "Expenditure",
  treasury: "Treasury",
  accounting: "Accounting",
  vendors: "Vendors",
  statutory: "Statutory",
  // misc
  new: "New",
  edit: "Edit",
  settings: "Settings",
  import: "Import",
  export: "Export",
  "salary-slips": "Salary Slips",
  "pay-groups": "Pay Groups",
  "chart-of-accounts": "Chart of Accounts",
  "general-ledger": "General Ledger",
  "audit-paras": "Audit Paras",
  "budget-formulation": "Budget Formulation",
  "bill-processing": "Bill Processing",
  "period-close": "Period Close",
  "fiscal-years": "Fiscal Years",
};

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Convert kebab-case / snake_case to Title Case
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isId(segment: string): boolean {
  return /^\d+$/.test(segment) || /^[0-9a-f-]{8,}$/i.test(segment);
}

export function AutoBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // Skip dynamic [id] segments — show their parent context only
  const crumbs: Array<{ label: string; href: string }> = [];
  let path = "";
  for (const seg of segments) {
    path += "/" + seg;
    if (isId(seg)) continue; // skip UUID / numeric IDs
    crumbs.push({ label: labelFor(seg), href: path });
  }

  if (crumbs.length === 0) return <b>CivitasOne</b>;
  if (crumbs.length === 1) return <b>{crumbs[0].label}</b>;

  return (
    <ol
      className="auto-crumb"
      aria-label="Breadcrumb"
      style={{ display: "flex", alignItems: "center", gap: 4, margin: 0, padding: 0, listStyle: "none", fontSize: 13 }}
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <li key={crumb.href} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {i > 0 && (
              <span aria-hidden="true" style={{ opacity: 0.35, fontSize: 10 }}>›</span>
            )}
            {isLast ? (
              <b aria-current="page">{crumb.label}</b>
            ) : (
              <Link
                href={crumb.href}
                style={{ color: "var(--ink2, #667085)", textDecoration: "none" }}
              >
                {crumb.label}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
