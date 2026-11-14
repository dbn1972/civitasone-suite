/**
 * THE module catalogue: the single source of truth for which modules exist, what each one
 * really depends on, which services implement it and which gateway route-keys it unlocks.
 *
 * Consumers (all derive from this file, none keep their own copy):
 *   - admin-service composition: the composition.module_registry rows are seeded by migrations
 *     0025/0026/0049/0050/0056/0059 and a real-DB test (services/admin-service/tests/module-catalogue-parity.test.ts)
 *     fails if the migrated table drifts from this file;
 *   - packages/schemas module-manifest.ts: the plan/provisioning `requires` lists are DERIVED from hardDeps here;
 *   - gateway route-keys: gatewayKeys here is parity-tested against admin-service composition/gateway-map.ts
 *     and against the gateway module-guard ROUTE_TO_MODULE;
 *   - M3/M5 (gateway module mode, licence check behind the gateway) read this file.
 *
 * hardDeps: the module cannot work without these (a synchronous call or a state it consumes that has no fallback).
 *           Enabling pulls them in; a module cannot be disabled while an enabled module hard-depends on it.
 * softDeps: events/calls used when present; the module degrades gracefully without them. Advisory only.
 * services: the services/<name> directories that implement the module (used by the dependency drift test).
 *
 * To add a cross-module dependency in code you MUST declare it here; packages/schemas/tests/module-catalogue-drift.test.ts
 * scans every service's src (topics.ts and *_SERVICE_URL usage) and fails otherwise.
 */
export interface CatalogueModule {
  readonly id: string;
  readonly name: string;
  readonly layer: number;
  readonly isCore: boolean;
  readonly cluster: string;
  readonly hardDeps: readonly string[];
  readonly softDeps: readonly string[];
  readonly screens: readonly string[];
  readonly sortOrder: number;
  readonly services: readonly string[];
  readonly gatewayKeys: readonly string[];
}

export const MODULE_CATALOGUE: readonly CatalogueModule[] = [
  { id: "identity", name: "Identity & Access", layer: 0, isCore: true, cluster: "core",
    hardDeps: [], softDeps: [],
    screens: ["Users", "Roles", "RBAC"], sortOrder: 10,
    services: ["identity-service"], gatewayKeys: [] },
  { id: "org", name: "Organisation & Hierarchy", layer: 0, isCore: true, cluster: "core",
    hardDeps: ["identity"], softDeps: [],
    screens: ["Org tree", "Offices", "Positions"], sortOrder: 20,
    services: ["tenant-service"], gatewayKeys: [] },
  { id: "config", name: "Config / Metadata Engine", layer: 0, isCore: true, cluster: "core",
    hardDeps: ["identity"], softDeps: [],
    screens: ["Entities", "Layouts", "Rules", "Feature flags"], sortOrder: 30,
    services: ["metadata-service"], gatewayKeys: [] },
  { id: "workflow", name: "Workflow / Maker-Checker", layer: 0, isCore: true, cluster: "core",
    hardDeps: ["identity"], softDeps: [],
    screens: ["Approvals"], sortOrder: 40,
    services: ["workflow-service"], gatewayKeys: ["workflow"] },
  { id: "audit", name: "Audit & Notification", layer: 0, isCore: true, cluster: "core",
    hardDeps: ["identity"], softDeps: [],
    screens: ["Audit log", "Notices"], sortOrder: 50,
    services: ["audit-service"], gatewayKeys: [] },
  { id: "employee", name: "Employee Master (HRIS)", layer: 1, isCore: false, cluster: "hr",
    hardDeps: ["org", "config"], softDeps: ["payroll", "meeting", "citizen"],
    screens: ["Employee Master", "e-Service Book", "Onboarding"], sortOrder: 60,
    services: ["hrms-service", "estab-service"], gatewayKeys: ["workforce_core", "establishment", "hrms-payroll", "hrms-training", "hrms-social", "hrms-disciplinary", "hrms-deputation", "hrms-contracts", "hrms-assessment", "hrms-id-cards", "hrms-ai", "hrms-rti", "hrms-workforce-planning", "hrms-board-intake", "hrms-competency"] },
  { id: "attendance", name: "Attendance", layer: 2, isCore: false, cluster: "hr",
    hardDeps: ["employee"], softDeps: [],
    screens: ["Attendance"], sortOrder: 70,
    services: ["hrms-service"], gatewayKeys: ["hrms-attendance"] },
  { id: "leave", name: "Leave Management", layer: 2, isCore: false, cluster: "hr",
    hardDeps: ["employee", "workflow", "config"], softDeps: ["attendance"],
    screens: ["Leave"], sortOrder: 80,
    services: ["hrms-service"], gatewayKeys: ["hrms-leave"] },
  { id: "recruitment", name: "Recruitment", layer: 2, isCore: false, cluster: "hr",
    hardDeps: ["org"], softDeps: ["employee"],
    screens: ["Manpower", "Recruitment & Selection"], sortOrder: 90,
    services: ["hrms-service"], gatewayKeys: ["hrms-recruitment"] },
  { id: "appraisal", name: "Appraisal (APAR/PMS)", layer: 2, isCore: false, cluster: "hr",
    hardDeps: ["employee", "workflow"], softDeps: [],
    screens: ["Appraisal"], sortOrder: 100,
    services: ["hrms-service"], gatewayKeys: ["hrms-appraisal"] },
  { id: "career", name: "Transfer & Promotion", layer: 2, isCore: false, cluster: "hr",
    hardDeps: ["employee", "workflow"], softDeps: [],
    screens: ["Transfers", "Promotion", "Pay Fixation"], sortOrder: 110,
    services: ["hrms-service"], gatewayKeys: ["hrms-recruitment"] },
  { id: "ess", name: "Self-Service & Grievance", layer: 4, isCore: false, cluster: "hr",
    hardDeps: ["employee"], softDeps: [],
    screens: ["ESS", "Grievance", "Reports/MIS"], sortOrder: 115,
    services: ["hrms-service"], gatewayKeys: ["hrms-self-service", "reports"] },
  { id: "workforce_core", name: "Workforce Core", layer: 1, isCore: false, cluster: "workforce",
    hardDeps: ["org", "config"], softDeps: [],
    screens: ["Employee Basics", "Office Hierarchy", "Cadre", "Sanctioned Post & Occupancy", "Posting Ledger"], sortOrder: 116,
    services: ["hrms-service"], gatewayKeys: ["workforce_core"] },
  { id: "smarttransfer", name: "SmartTransfer OS", layer: 2, isCore: false, cluster: "workforce",
    hardDeps: ["workforce_core", "workflow", "audit"], softDeps: ["employee"],
    screens: ["Transfer Cycle", "Eligibility", "Preferences", "Allocation", "Movement Orders", "Relieving & Joining"], sortOrder: 118,
    services: ["smarttransfer-service"], gatewayKeys: ["smarttransfer"] },
  { id: "finance", name: "Finance / General Ledger", layer: 3, isCore: false, cluster: "finance",
    hardDeps: ["config"], softDeps: ["payroll", "procurement", "grant", "billing", "citizen", "meeting", "revenue"],
    screens: ["General Ledger", "Vouchers"], sortOrder: 120,
    services: ["finance-service"], gatewayKeys: ["finance"] },
  { id: "payroll", name: "Payroll & Salary", layer: 3, isCore: false, cluster: "payroll",
    hardDeps: ["employee", "config"], softDeps: ["attendance", "leave", "loans", "finance", "benefits"],
    screens: ["Payroll & Salary Slip"], sortOrder: 130,
    services: ["payroll-service"], gatewayKeys: ["payroll"] },
  { id: "loans", name: "Loans & Advances", layer: 3, isCore: false, cluster: "payroll",
    hardDeps: ["employee"], softDeps: ["payroll"],
    screens: ["Loans & Advances"], sortOrder: 140,
    services: ["payroll-service"], gatewayKeys: ["payroll"] },
  { id: "benefits", name: "Travel / Medical / LTC", layer: 3, isCore: false, cluster: "payroll",
    hardDeps: ["employee"], softDeps: ["payroll"],
    screens: ["Tour/TA/DA/LTC", "Medical/CGHS"], sortOrder: 150,
    services: ["payroll-service"], gatewayKeys: ["payroll"] },
  { id: "separation", name: "Separation & Pension", layer: 3, isCore: false, cluster: "payroll",
    hardDeps: ["employee"], softDeps: ["payroll"],
    screens: ["Separation", "Pension & Settlement"], sortOrder: 160,
    services: ["payroll-service"], gatewayKeys: ["payroll"] },
  { id: "budget", name: "Budget & Appropriation", layer: 3, isCore: false, cluster: "finance",
    hardDeps: ["finance"], softDeps: [],
    screens: ["Budget preparation", "Appropriation", "Re-appropriation"], sortOrder: 200,
    services: ["finance-service"], gatewayKeys: ["finance"] },
  { id: "treasury", name: "Treasury & Cash", layer: 3, isCore: false, cluster: "finance",
    hardDeps: ["finance"], softDeps: ["budget"],
    screens: ["Treasury", "PD accounts", "Cheque/DD"], sortOrder: 210,
    services: ["finance-service"], gatewayKeys: ["finance"] },
  { id: "revenue", name: "Revenue & Receipts", layer: 3, isCore: false, cluster: "finance",
    hardDeps: ["finance"], softDeps: [],
    screens: ["Demands", "Collections", "Challan/Receipt"], sortOrder: 220,
    services: ["revenue-service"], gatewayKeys: ["finance"] },
  { id: "procurement", name: "Procurement", layer: 3, isCore: false, cluster: "p2p",
    hardDeps: ["finance", "budget", "workflow"], softDeps: ["contract", "legal", "inventory", "meeting", "employee"],
    screens: ["Indent", "Tender", "PO", "GRN"], sortOrder: 230,
    services: ["procurement-service"], gatewayKeys: ["procurement"] },
  { id: "contract", name: "Contracts", layer: 3, isCore: false, cluster: "p2p",
    hardDeps: ["workflow", "procurement"], softDeps: [],
    screens: ["Contracts", "Milestones", "Amendments"], sortOrder: 240,
    services: ["contract-service"], gatewayKeys: ["contracts"] },
  { id: "inventory", name: "Inventory & Stores", layer: 3, isCore: false, cluster: "p2p",
    hardDeps: ["finance", "procurement"], softDeps: [],
    screens: ["Stores", "GRN", "Issue/Return"], sortOrder: 250,
    services: ["inventory-service", "stock-service"], gatewayKeys: ["inventory", "stock"] },
  { id: "asset", name: "Asset Management", layer: 3, isCore: false, cluster: "p2p",
    hardDeps: ["finance"], softDeps: ["procurement", "works", "workflow"],
    screens: ["Asset register", "Depreciation", "Disposal"], sortOrder: 260,
    services: ["asset-service"], gatewayKeys: ["assets"] },
  { id: "works", name: "Works & Contracts Exec", layer: 3, isCore: false, cluster: "delivery",
    hardDeps: ["finance", "budget"], softDeps: ["procurement", "grant"],
    screens: ["Works estimate", "BOQ", "RA bill"], sortOrder: 270,
    services: ["works-service"], gatewayKeys: ["projects"] },
  { id: "project", name: "Project Management", layer: 2, isCore: false, cluster: "delivery",
    hardDeps: ["config"], softDeps: ["grant", "finance", "meeting", "employee", "payroll"],
    screens: ["Projects", "WBS", "Milestones"], sortOrder: 280,
    services: ["project-service"], gatewayKeys: ["projects"] },
  { id: "grant", name: "Grants & Schemes", layer: 3, isCore: false, cluster: "delivery",
    hardDeps: ["finance", "budget"], softDeps: ["project"],
    screens: ["Schemes", "Sanction", "Utilisation (UC)"], sortOrder: 290,
    services: ["grant-service"], gatewayKeys: ["grants"] },
  { id: "citizen", name: "Citizen Services", layer: 2, isCore: false, cluster: "citizen",
    hardDeps: ["workflow"], softDeps: ["finance", "employee"],
    screens: ["Services catalogue", "Applications", "Grievances"], sortOrder: 300,
    services: ["citizen-service"], gatewayKeys: ["citizen"] },
  { id: "crm", name: "CRM", layer: 2, isCore: false, cluster: "citizen",
    hardDeps: [], softDeps: ["telephony"],
    screens: ["Contacts", "Leads", "Cases"], sortOrder: 310,
    services: ["crm-service"], gatewayKeys: ["crm"] },
  { id: "helpdesk", name: "Helpdesk & SLA", layer: 2, isCore: false, cluster: "citizen",
    hardDeps: [], softDeps: ["citizen", "crm", "asset", "knowledge", "telephony"],
    screens: ["Tickets", "SLA", "Service catalogue"], sortOrder: 320,
    services: ["helpdesk-service"], gatewayKeys: ["helpdesk"] },
  { id: "knowledge", name: "Knowledge Base", layer: 2, isCore: false, cluster: "citizen",
    hardDeps: [], softDeps: ["helpdesk"],
    screens: ["Articles", "FAQ", "Categories"], sortOrder: 330,
    services: ["knowledge-service"], gatewayKeys: ["knowledge"] },
  { id: "legal", name: "Legal / RTI / Vigilance", layer: 2, isCore: false, cluster: "governance",
    hardDeps: ["workflow", "employee"], softDeps: ["meeting"],
    screens: ["Cases", "RTI", "Vigilance"], sortOrder: 340,
    services: ["legal-service"], gatewayKeys: ["legal"] },
  { id: "inspection", name: "Inspection & Enforcement", layer: 2, isCore: false, cluster: "governance",
    hardDeps: ["employee", "workflow"], softDeps: ["leave"],
    screens: ["Inspections", "Checklists", "Findings"], sortOrder: 350,
    services: ["inspection-service"], gatewayKeys: ["inspection"] },
  { id: "analytics", name: "Analytics & MIS", layer: 4, isCore: false, cluster: "insight",
    hardDeps: ["config"], softDeps: ["finance", "procurement", "grant", "employee", "meeting", "court", "visitor"],
    screens: ["Dashboards", "MIS reports", "KPIs"], sortOrder: 360,
    services: ["analytics-service", "report-service"], gatewayKeys: ["analytics", "reports"] },
  { id: "telephony", name: "Telephony / IVR", layer: 3, isCore: false, cluster: "services",
    hardDeps: [], softDeps: [],
    screens: ["Telephony"], sortOrder: 400,
    services: ["telephony-service"], gatewayKeys: ["telephony"] },
  { id: "meeting", name: "Meetings", layer: 3, isCore: false, cluster: "services",
    hardDeps: [], softDeps: ["employee"],
    screens: ["Meetings"], sortOrder: 410,
    services: ["meeting-service"], gatewayKeys: ["meeting"] },
  { id: "court", name: "Court Management", layer: 3, isCore: false, cluster: "services",
    hardDeps: [], softDeps: [],
    screens: ["Court cases"], sortOrder: 420,
    services: ["court-service"], gatewayKeys: ["court"] },
  { id: "visitor", name: "Visitor Management", layer: 3, isCore: false, cluster: "services",
    hardDeps: [], softDeps: [],
    screens: ["Visitors"], sortOrder: 430,
    services: ["visitor-service"], gatewayKeys: ["visitor"] },
  { id: "billing", name: "Billing", layer: 3, isCore: false, cluster: "services",
    hardDeps: [], softDeps: [],
    screens: ["Billing"], sortOrder: 440,
    services: ["billing-service"], gatewayKeys: ["billing"] },
  { id: "field", name: "Field Operations", layer: 3, isCore: false, cluster: "services",
    hardDeps: [], softDeps: ["inspection"],
    screens: ["Field tasks", "Visits", "Routes"], sortOrder: 450,
    services: ["field-service"], gatewayKeys: ["field"] },
  { id: "shop", name: "Shops & Establishments", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Shops & Establishments"], sortOrder: 500,
    services: ["shop-service"], gatewayKeys: ["shop"] },
  { id: "trade", name: "Trade Licences", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Trade Licences"], sortOrder: 501,
    services: ["trade-service"], gatewayKeys: ["trade"] },
  { id: "building", name: "Building Permissions", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Building Permissions"], sortOrder: 502,
    services: ["building-service"], gatewayKeys: ["building"] },
  { id: "fire", name: "Fire NOC", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Fire NOC"], sortOrder: 503,
    services: ["fire-service"], gatewayKeys: ["fire"] },
  { id: "advertisement", name: "Advertisement Permits", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Advertisement Permits"], sortOrder: 504,
    services: ["advertisement-service"], gatewayKeys: ["advertisement"] },
  { id: "vendor", name: "Street Vendors", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Street Vendors"], sortOrder: 505,
    services: ["vendor-service"], gatewayKeys: ["vendor"] },
  { id: "roadcut", name: "Road-cut Permissions", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Road-cut Permissions"], sortOrder: 506,
    services: ["roadcut-service"], gatewayKeys: ["roadcut"] },
  { id: "event", name: "Event Permissions", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Event Permissions"], sortOrder: 507,
    services: ["event-service"], gatewayKeys: ["event"] },
  { id: "refund", name: "Refunds", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Refunds"], sortOrder: 508,
    services: ["refund-service"], gatewayKeys: ["refund"] },
  { id: "sewerage", name: "Sewerage", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Sewerage"], sortOrder: 509,
    services: ["sewerage-service"], gatewayKeys: ["sewerage"] },
  { id: "swm", name: "Solid Waste Management", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Solid Waste Management"], sortOrder: 510,
    services: ["swm-service"], gatewayKeys: ["swm"] },
  { id: "drainage", name: "Drainage", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Drainage"], sortOrder: 511,
    services: ["drainage-service"], gatewayKeys: ["drainage"] },
  { id: "parks", name: "Parks & Gardens", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Parks & Gardens"], sortOrder: 512,
    services: ["parks-service"], gatewayKeys: ["parks"] },
  { id: "animal", name: "Animal Licensing", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Animal Licensing"], sortOrder: 513,
    services: ["animal-service"], gatewayKeys: ["animal"] },
  { id: "crematorium", name: "Crematoria", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Crematoria"], sortOrder: 514,
    services: ["crematorium-service"], gatewayKeys: ["crematorium"] },
  { id: "parking", name: "Parking", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Parking"], sortOrder: 515,
    services: ["parking-service"], gatewayKeys: ["parking"] },
  { id: "market", name: "Markets", layer: 3, isCore: false, cluster: "municipal",
    hardDeps: [], softDeps: [],
    screens: ["Markets"], sortOrder: 516,
    services: ["market-service"], gatewayKeys: ["market"] },
];

export const CATALOGUE_BY_ID: ReadonlyMap<string, CatalogueModule> = new Map(MODULE_CATALOGUE.map((m) => [m.id, m]));

/**
 * Legacy gateway route-key -> catalogue modules (the inverse of gatewayKeys), used to carry the older
 * config.admin_module_configs switch list into the catalogue (migration 0059) and to derive that list back
 * from the catalogue (admin-service MODULE_SOURCE=catalogue). The bare legacy `hrms` key is one blanket switch
 * for the HR cluster (the module-guard split it into hrms-<x> keys only under composition).
 * hrms-<x> sub-keys and workforce_core are composition-only keys; a legacy list never carries them.
 */
export const LEGACY_BLANKET_HRMS_MODULES: readonly string[] = ["employee", "attendance", "leave", "recruitment", "appraisal", "career", "ess"];

export function legacyKeyToModules(): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const m of MODULE_CATALOGUE) {
    if (m.isCore) continue;
    for (const k of m.gatewayKeys) {
      if (k.startsWith("hrms-") || k === "workforce_core") continue;
      out.set(k, [...(out.get(k) ?? []), m.id]);
    }
  }
  out.set("hrms", [...LEGACY_BLANKET_HRMS_MODULES]);
  return out;
}

/**
 * The older switch list (legacy gateway route-keys) that corresponds to a resolved set of catalogue modules.
 * Inverse of legacyKeyToModules(): the bare `hrms` key is present when any HR-cluster module is.
 */
export function legacyKeysFromModules(moduleIds: Iterable<string>): string[] {
  const ids = new Set(moduleIds);
  const keys = new Set<string>();
  for (const m of MODULE_CATALOGUE) {
    if (m.isCore || !ids.has(m.id)) continue;
    for (const k of m.gatewayKeys) if (!k.startsWith("hrms-") && k !== "workforce_core") keys.add(k);
  }
  if (LEGACY_BLANKET_HRMS_MODULES.some((id) => ids.has(id))) keys.add("hrms");
  return [...keys].sort();
}
