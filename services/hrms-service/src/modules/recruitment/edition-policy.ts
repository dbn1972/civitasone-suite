/**
 * GAP-RECRUITMENT-NEW-06: per-edition recruitment policy (pure domain, no I/O).
 *
 * Government editions must source every public vacancy from a fully approved requisition
 * (R-RA-0056: POST /v1/hrms/requisitions/:id/publish); direct vacancy creation would bypass the
 * approval chain and could put an unsanctioned post in front of the public. Small Office (and, by
 * default, PSU) tenants keep direct creation. The edition default can be overridden per tenant.
 */
export const EDITIONS = ["govt", "psu", "small_office"] as const;
export type Edition = (typeof EDITIONS)[number];

export interface EditionPolicy {
  edition: Edition;
  /** null = follow the edition default; true/false = explicit per-tenant override. */
  requireRequisition: boolean | null;
}

/** tenant.tenants.edition values that mean a Government edition (requisition-first by default). */
const GOVT_TENANT_EDITIONS = new Set(["govt", "govt_dept"]);
/** The other known tenant editions (tenant-service schema.ts): default OFF. */
const OTHER_TENANT_EDITIONS = new Set(["psu", "private", "ngo", "section8", "cooperative", "small_office"]);

/**
 * Map tenant.tenants.edition to the policy edition used when the tenant has no stored policy row.
 * govt / govt_dept -> 'govt' (requisition-first ON); every other KNOWN edition -> its non-govt equivalent (OFF);
 * undefined or an unrecognised value -> null: the caller keeps the current behaviour (OFF) and logs a warning.
 */
export function editionFromTenant(raw: string | null | undefined): Edition | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (GOVT_TENANT_EDITIONS.has(v)) return "govt";
  if (v === "psu") return "psu";
  if (OTHER_TENANT_EDITIONS.has(v)) return "small_office";
  return null;
}

/** No stored row == Small Office == today's behaviour (direct creation allowed). */
export const DEFAULT_POLICY: EditionPolicy = { edition: "small_office", requireRequisition: null };

/** ON for the Govt edition, OFF for everything else, unless the tenant has an explicit override. */
export function requisitionRequired(p: EditionPolicy | null | undefined): boolean {
  const policy = p ?? DEFAULT_POLICY;
  if (policy.requireRequisition !== null) return policy.requireRequisition;
  return policy.edition === "govt";
}

export const REQUISITION_REQUIRED_MESSAGE =
  "this edition requires every vacancy to originate from a fully approved requisition; "
  + "create and approve a requisition, then publish it (POST /v1/hrms/requisitions/:id/publish)";
