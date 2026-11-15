/**
 * Global-search entity catalogue: the SINGLE source of truth for which record types are searchable across
 * modules, which roles may see each type, and where its record page lives.
 *
 * PERMISSIONS. `readRoles` mirrors, verbatim, the role list that the OWNING service enforces on the read route of
 * that record (cited per entry). The gateway derives, per request and from the caller's JWT roles, the set of
 * entity types the caller may see and puts it in the engine query as a server-built filter. Because the decision is
 * taken at QUERY time from this catalogue (not stored on the document), a role change takes effect immediately and
 * there is no stale per-document ACL to repair. A type with no matching role is never queried (fail closed).
 *
 * Where the owning module narrows access per record (e.g. a manager sees only their own reports), the type is
 * limited to the tenant-wide roles only: an index cannot mirror a per-record scope, so the scoped roles are left out.
 */

export interface GlobalEntityDef {
  readonly module: string;
  /** English label; the web shell translates it through `search.types.<camelCase of the type>`. */
  readonly label: string;
  /** Roles that may read this record type in its own module. Source cited above each entry. */
  readonly readRoles: readonly string[];
  /** Record page for one hit. `id` is a UUID (validated at index time), `ref` the business number. */
  readonly href: (id: string, ref: string | undefined) => string;
}

export const GLOBAL_ENTITY_TYPES = {
  // services/finance-service/src/modules/gl/routes.ts:22 READER_ROLES (GET /v1/finance/journals)
  "finance.voucher": {
    module: "finance",
    label: "Vouchers",
    readRoles: ["finance_officer", "finance_admin", "super_admin", "audit_officer"],
    // There is no per-voucher page: land on the general ledger filtered by voucher number.
    href: (_id, ref) => `/finance/accounting/general-ledger${ref ? `?voucher=${encodeURIComponent(ref)}` : ""}`,
  },
  // services/finance-service/src/modules/payments/routes.ts:69 READER_ROLES (GET /v1/finance/bills/:id)
  "finance.bill": {
    module: "finance",
    label: "Bills",
    readRoles: ["finance_officer", "finance_admin", "super_admin", "audit_officer", "procurement_officer"],
    href: (id) => `/finance/expenditure/bills/${id}`,
  },
  // services/finance-service/src/modules/masters/routes.ts:17 READER_ROLES (GET /v1/finance/vendors/:id)
  "finance.vendor": {
    module: "finance",
    label: "Vendors",
    readRoles: ["finance_officer", "finance_admin", "super_admin", "audit_officer"],
    href: (id) => `/finance/vendors/${id}`,
  },
  // services/hrms-service/src/modules/employee/routes.ts:23,52 HR_ROLES + PAYROLL_DIRECTORY_ROLES, the roles whose
  // directory LIST is tenant-wide. `manager` (scoped to direct reports) and `employee` are deliberately absent.
  "hrms.employee": {
    module: "hrms",
    label: "Employees",
    readRoles: ["hr_admin", "hr_officer", "super_admin", "payroll_admin", "payroll_officer"],
    href: (id) => `/hr/employees/${id}`,
  },
  // services/procurement-service/src/modules/indent/routes.ts:13-14 READER_ROLES
  "procurement.indent": {
    module: "procurement",
    label: "Indents",
    readRoles: ["procurement_officer", "procurement_admin", "super_admin", "audit_officer", "finance_officer"],
    href: (id) => `/procurement/indents/${id}`,
  },
  // services/procurement-service/src/modules/po/routes.ts:29-30 READER_ROLES
  "procurement.po": {
    module: "procurement",
    label: "Purchase orders",
    readRoles: ["procurement_officer", "procurement_admin", "super_admin", "audit_officer", "finance_officer"],
    href: (id) => `/procurement/orders/${id}`,
  },
  // services/contract-service/src/modules/contracts/routes.ts:19-20 READER_ROLES (GET /v1/contract/contracts/:id)
  "contracts.contract": {
    module: "contracts",
    label: "Contracts",
    readRoles: ["procurement_admin", "finance_admin", "super_admin", "audit_officer", "procurement_officer"],
    href: (id) => `/contracts/${id}`,
  },
  // services/meeting-service/src/modules/meeting-core/routes.ts:86 READ_ROLES (GET /v1/meetings/:meetingId).
  // Only public/internal meetings are ever indexed (see meeting-service shared/global-search.ts).
  "meeting.meeting": {
    module: "meeting",
    label: "Meetings",
    readRoles: ["meeting_admin", "committee_secretary", "committee_chairperson", "committee_member", "observer", "tenant_admin", "super_admin", "admin"],
    href: (id) => `/meeting/meetings/${id}`,
  },
  // services/estab-service/src/modules/files/routes.ts:88-89 READER_ROLES (GET /v1/estab/files/:id).
  // Only public, non-VIP files are ever indexed: per-officer clearance cannot be mirrored in an index.
  "estab.file": {
    module: "establishment",
    label: "Establishment files",
    readRoles: ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin", "audit_officer"],
    href: (id) => `/estab/files/${id}`,
  },
  // services/citizen-service/src/modules/application/routes.ts:11 OFFICER_ROLES. The applicant's own role (`citizen`)
  // is deliberately absent: a citizen reads only their own applications, which an index cannot express.
  // There is no per-application page yet: link to the services page filtered by reference number.
  "citizen.application": {
    module: "citizen",
    label: "Citizen applications",
    readRoles: ["citizen_officer", "citizen_admin", "super_admin"],
    href: (_id, ref) => `/citizen/services${ref ? `?application=${encodeURIComponent(ref)}` : ""}`,
  },
} as const satisfies Record<string, GlobalEntityDef>;

export type GlobalEntityType = keyof typeof GLOBAL_ENTITY_TYPES;

export const GLOBAL_ENTITY_TYPE_LIST = Object.keys(GLOBAL_ENTITY_TYPES) as GlobalEntityType[];

export function isGlobalEntityType(value: unknown): value is GlobalEntityType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GLOBAL_ENTITY_TYPES, value);
}

/** Entity types the caller may see, from JWT roles. Empty roles / unknown roles => empty (fail closed). */
export function entityTypesForRoles(roles: readonly string[] | null | undefined): GlobalEntityType[] {
  if (!roles || roles.length === 0) return [];
  const have = new Set(roles);
  return GLOBAL_ENTITY_TYPE_LIST.filter((t) => GLOBAL_ENTITY_TYPES[t].readRoles.some((r) => have.has(r)));
}

export function hrefForEntity(type: GlobalEntityType, id: string, ref?: string): string {
  return GLOBAL_ENTITY_TYPES[type].href(id, ref);
}
