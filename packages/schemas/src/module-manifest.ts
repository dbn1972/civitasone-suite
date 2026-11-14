/**
 * Module Dependency Manifest for CivitasOne.
 *
 * Defines the dependency graph between modules. When a module is enabled,
 * all its required dependencies are auto-enabled (possibly in "thin" mode
 * where only the API/data layer is active, not full UI).
 *
 * SINGLE SOURCE: the `requires` lists are NOT maintained here. They are derived from the module catalogue
 * (module-catalogue.ts hardDeps, which is verified against the service code by tests/module-catalogue-drift.test.ts)
 * through PRODUCT_TO_CATALOGUE / CATALOGUE_REF below. Edit the catalogue, never this list.
 *
 * Foundation modules (identity, tenant, policy, audit, notification, workflow,
 * queue, gateway, install) are ALWAYS enabled and not listed here as selectable.
 */

import { CATALOGUE_BY_ID } from "./module-catalogue.js";

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

const MANIFEST_ENTRIES: ModuleDef[] = [
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
    requires: [],
  },
  {
    id: "procurement",
    name: "Procurement",
    description: "Indent → Tender → PO → GRN → 3-way match",
    requires: [],
  },
  {
    id: "contract",
    name: "Contract Management",
    description: "Agreement lifecycle, milestones, penalties",
    requires: [],
  },
  {
    id: "asset",
    name: "Fixed Assets",
    description: "Asset register, depreciation, disposal",
    requires: [],
  },
  {
    id: "stock",
    name: "Stock & Stores",
    description: "Consumable inventory, FIFO/moving-avg valuation",
    requires: [],
  },
  {
    id: "inventory",
    name: "Warehouse Management",
    description: "Warehouse, bins, issue/receipt, stock transfer",
    requires: [],
  },
  {
    id: "estab",
    name: "Establishment (eOffice)",
    description: "DAK, files, green notes, DSC, dispatch",
    requires: [],
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
    requires: [],
  },
  {
    id: "project",
    name: "Project Management",
    description: "Works/capital projects, milestones, utilization",
    requires: [],
  },
  {
    id: "works",
    name: "Works & Billing",
    description: "Engineering works lifecycle — proposal, approval, BoQ, tender, execution, billing",
    requires: [],
    subModules: [
      { id: "proposal", name: "Work Proposals", description: "Work registration, COA, splitting" },
      { id: "boq", name: "Bill of Quantities", description: "SR items, measurements, recapitulation" },
      { id: "tender", name: "Tendering", description: "Pre-tender, quotation, award" },
      { id: "execution", name: "Execution & Monitoring", description: "Scope progress, photos, issues" },
      { id: "billing", name: "Works Billing", description: "e-MB, RA bills, abstract bills" },
    ],
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
    requires: [],
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

/**
 * Plan/provisioning products (this file's ids) -> the catalogue modules they consist of. Several catalogue
 * modules can live in one product (hrms covers employee..ess), and two products can share one catalogue
 * module (stock and inventory are the two services of the catalogue module `inventory`).
 */
export const PRODUCT_TO_CATALOGUE: Readonly<Record<string, readonly string[]>> = {
  finance: ["finance", "budget", "treasury"],
  hrms: ["employee", "attendance", "leave", "recruitment", "appraisal", "career", "ess"],
  payroll: ["payroll", "loans", "benefits", "separation"],
  procurement: ["procurement"],
  contract: ["contract"],
  asset: ["asset"],
  stock: ["inventory"],
  inventory: ["inventory"],
  estab: ["employee"],
  citizen: ["citizen"],
  legal: ["legal"],
  crm: ["crm"],
  helpdesk: ["helpdesk"],
  grant: ["grant"],
  project: ["project"],
  works: ["works"],
  billing: ["billing"],
  court: ["court"],
  meeting: ["meeting"],
  visitor: ["visitor"],
  telephony: ["telephony"],
  analytics: ["analytics"],
  knowledge: ["knowledge"],
};

/** Catalogue module -> the manifest reference a dependent product uses (sub-module slice = thin mode). */
const CATALOGUE_REF: Readonly<Record<string, string>> = {
  employee: "hrms:employees",
  attendance: "hrms:attendance",
  leave: "hrms:leave",
  recruitment: "hrms:careers",
  finance: "finance:gl",
  budget: "finance:budgets",
  treasury: "finance:treasury",
  revenue: "finance",
  procurement: "procurement",
  contract: "contract",
  inventory: "stock",
  asset: "asset",
  works: "works",
  project: "project",
  grant: "grant",
  citizen: "citizen",
  legal: "legal",
  court: "court",
  meeting: "meeting",
  payroll: "payroll",
};

/** Structural pairs: one catalogue module implemented by two products. */
const STRUCTURAL_REQUIRES: Readonly<Record<string, readonly string[]>> = { inventory: ["stock"], estab: ["hrms:employees"] };

function deriveRequires(productId: string): string[] {
  const mods = PRODUCT_TO_CATALOGUE[productId];
  if (!mods) return [];
  const out = new Set<string>(STRUCTURAL_REQUIRES[productId] ?? []);
  for (const id of mods) {
    for (const dep of CATALOGUE_BY_ID.get(id)?.hardDeps ?? []) {
      const d = CATALOGUE_BY_ID.get(dep);
      if (!d || d.isCore || mods.includes(dep)) continue;
      const ref = CATALOGUE_REF[dep];
      if (!ref) throw new Error(`module-manifest: no manifest reference for catalogue module ${dep} (required by ${productId})`);
      // a product never lists itself (stock <-> inventory share a catalogue module)
      if (ref.split(":")[0] !== productId) out.add(ref);
    }
  }
  return [...out].sort();
}

export const MODULE_MANIFEST: ModuleDef[] = MANIFEST_ENTRIES.map((m) => ({ ...m, requires: deriveRequires(m.id) }));
