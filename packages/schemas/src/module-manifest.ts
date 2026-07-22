/**
 * Module Dependency Manifest for CivitasOne.
 *
 * Defines the dependency graph between modules. When a module is enabled,
 * all its required dependencies are auto-enabled (possibly in "thin" mode
 * where only the API/data layer is active, not full UI).
 *
 * Foundation modules (identity, tenant, policy, audit, notification, workflow,
 * queue, gateway, install) are ALWAYS enabled and not listed here as selectable.
 */

export interface ModuleDef {
  /** Module identifier (matches service name without "-service" suffix) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /**
   * Required dependencies. Format: "module" for full module or "module:submodule"
   * for a specific sub-module slice (thin mode — API only, no UI).
   */
  requires: string[];
  /**
   * Sub-modules this module exposes. Other modules can depend on specific
   * sub-modules rather than the full module.
   */
  subModules?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  /** Whether this is a foundation module (always enabled, can't be disabled) */
  foundation?: boolean;
}

export const MODULE_MANIFEST: ModuleDef[] = [
  // ── Foundation (always on) ──────────────────────────────────────────────
  { id: "identity", name: "Identity & Auth", description: "Users, authentication, Keycloak OIDC/SAML", requires: [], foundation: true },
  { id: "tenant", name: "Tenant Management", description: "Multi-tenant provisioning and isolation", requires: [], foundation: true },
  { id: "policy", name: "Access Policy", description: "RBAC rules and permission enforcement", requires: [], foundation: true },
  { id: "gateway", name: "API Gateway", description: "Routing, rate limiting, JWT validation", requires: [], foundation: true },
  { id: "audit", name: "Audit Trail", description: "Tamper-evident audit logging (CERT-In)", requires: [], foundation: true },
  { id: "notification", name: "Notifications", description: "Email, SMS, push, in-app delivery", requires: [], foundation: true },
  { id: "workflow", name: "Workflow Engine", description: "Approval chains, SLA, DMN decisions", requires: [], foundation: true },
  { id: "queue", name: "Event Bus", description: "SQS/RabbitMQ event orchestration", requires: [], foundation: true },
  { id: "install", name: "Install Wizard", description: "Tenant setup and module provisioning", requires: [], foundation: true },
  { id: "admin", name: "Platform Admin", description: "Configuration management", requires: [], foundation: true },

  // ── Core Business ──────────────────────────────────────────────────────
  {
    id: "finance",
    name: "Finance & Accounts",
    description: "GL, budgets, bills, payments, treasury, PFMS integration",
    requires: [],
    subModules: [
      { id: "gl", name: "General Ledger", description: "Chart of accounts, journal entries, trial balance" },
      { id: "budgets", name: "Budget Management", description: "Budget heads, allocation, utilization tracking" },
      { id: "bills", name: "Bill Processing", description: "Bill creation, 3-way match, payment scheduling" },
      { id: "treasury", name: "Treasury", description: "Bank accounts, reconciliation, cash flow" },
    ],
  },
  {
    id: "hrms",
    name: "Human Resource Management",
    description: "Employee lifecycle, attendance, leave, transfers",
    requires: [],
    subModules: [
      { id: "employees", name: "Employee Master", description: "Employee records, pay structure, bank details" },
      { id: "attendance", name: "Attendance", description: "Daily attendance, biometric, summary reports" },
      { id: "leave", name: "Leave Management", description: "Leave types, applications, balance tracking" },
      { id: "transfers", name: "Transfers & Postings", description: "Transfer orders, joining reports" },
      { id: "careers", name: "Recruitment", description: "Job postings, applications, interview scheduling" },
    ],
  },
  {
    id: "payroll",
    name: "Payroll",
    description: "Salary computation, 7th CPC, TDS, PF, disbursement",
    requires: ["hrms:employees", "hrms:attendance", "finance:gl"],
  },
  {
    id: "procurement",
    name: "Procurement",
    description: "Indent → Tender → PO → GRN → 3-way match",
    requires: ["finance:budgets", "finance:bills"],
  },
  {
    id: "contract",
    name: "Contract Management",
    description: "Agreement lifecycle, milestones, penalties",
    requires: ["finance:bills", "procurement"],
  },
  {
    id: "asset",
    name: "Fixed Assets",
    description: "Asset register, depreciation, disposal",
    requires: ["finance:gl", "procurement"],
  },
  {
    id: "stock",
    name: "Stock & Stores",
    description: "Consumable inventory, FIFO/moving-avg valuation",
    requires: ["procurement"],
  },
  {
    id: "inventory",
    name: "Warehouse Management",
    description: "Warehouse, bins, issue/receipt, stock transfer",
    requires: ["stock"],
  },
  {
    id: "estab",
    name: "Establishment (eOffice)",
    description: "DAK, files, green notes, DSC, dispatch",
    requires: ["hrms:employees"],
  },

  // ── Domain-Specific ────────────────────────────────────────────────────
  {
    id: "citizen",
    name: "Citizen Services",
    description: "RTI, grievances, service requests, tracking",
    requires: [],
    subModules: [
      { id: "applications", name: "Applications", description: "Service request intake and tracking" },
      { id: "grievances", name: "Grievances", description: "Grievance filing and resolution" },
      { id: "rti", name: "RTI", description: "Right to Information requests" },
    ],
  },
  {
    id: "legal",
    name: "Legal Affairs",
    description: "Case management, opinions, court dates",
    requires: [],
  },
  {
    id: "crm",
    name: "CRM",
    description: "Contacts, leads, interactions",
    requires: [],
  },
  {
    id: "helpdesk",
    name: "Helpdesk",
    description: "IT/internal ticketing, SLA tracking",
    requires: [],
  },
  {
    id: "grant",
    name: "Grant Management",
    description: "Scheme management, applications, disbursement",
    requires: ["finance:gl", "citizen:applications"],
  },
  {
    id: "project",
    name: "Project Management",
    description: "Works/capital projects, milestones, utilization",
    requires: ["finance:budgets"],
  },
  {
    id: "billing",
    name: "SaaS Billing",
    description: "Subscription management, invoicing, usage metering",
    requires: [],
  },
  {
    id: "court",
    name: "Court Case Tracking",
    description: "Hearing dates, orders, case history",
    requires: ["legal"],
  },
  {
    id: "meeting",
    name: "Meeting Governance",
    description: "Meeting scheduling, minutes, action items",
    requires: [],
  },
  {
    id: "visitor",
    name: "Visitor Management",
    description: "Pass management, check-in/out, evacuation",
    requires: [],
  },
  {
    id: "telephony",
    name: "Telephony",
    description: "Call logging, IVR integration",
    requires: [],
  },

  // ── Supporting ─────────────────────────────────────────────────────────
  {
    id: "analytics",
    name: "Analytics",
    description: "Dashboards, custom queries, materialized views",
    requires: [],
  },
  {
    id: "report",
    name: "Reports",
    description: "Template-based report generation",
    requires: [],
  },
  {
    id: "knowledge",
    name: "Knowledge Base",
    description: "Articles, search, FAQ management",
    requires: [],
  },
  {
    id: "location",
    name: "Location & GIS",
    description: "Address master, jurisdiction mapping",
    requires: [],
  },
  {
    id: "plugin",
    name: "Plugin Marketplace",
    description: "Extension lifecycle management",
    requires: [],
  },
  {
    id: "theme",
    name: "Theme Customization",
    description: "UI customization per tenant",
    requires: [],
  },
  {
    id: "metadata",
    name: "Custom Objects",
    description: "Custom fields/objects engine",
    requires: [],
  },
  {
    id: "ml",
    name: "ML & AI",
    description: "Prediction, anomaly detection, NLP",
    requires: [],
  },
];
