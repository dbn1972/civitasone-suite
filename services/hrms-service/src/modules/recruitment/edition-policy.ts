/**
 * GAP-RECRUITMENT-NEW-06: per-edition recruitment policy (pure domain, no I/O).
 *
 * Government editions must source every public vacancy from a fully approved requisition
 * (R-RA-0056: POST /v1/hrms/requisitions/:id/publish); direct vacancy creation would bypass the
 * approval chain and could put an unsanctioned post in front of the public. Small Office (and, by
 * default, PSU) tenants keep direct creation. The edition default can be overridden per tenant.
 */
import { recruitmentPolicyForEdition } from "@civitasone/tenant-profile";

export const EDITIONS = ["govt", "psu", "small_office"] as const;
export type Edition = (typeof EDITIONS)[number];

export interface EditionPolicy {
  edition: Edition;
  /** null = follow the edition default; true/false = explicit per-tenant override. */
  requireRequisition: boolean | null;
}

/**
 * Map tenant.tenants.edition to the policy edition used when the tenant has no stored policy row. The default is read from
 * the @civitasone/tenant-profile catalogue (`recruitmentPolicy`): requisition_first -> 'govt' (ON); direct -> its non-govt
 * equivalent (OFF; PSU keeps 'psu', every other known edition, e.g. section8, is 'small_office'). undefined or an
 * unrecognised value -> null: the caller keeps the current behaviour (OFF) and logs a warning.
 */
export function editionFromTenant(raw: string | null | undefined): Edition | null {
  const policy = recruitmentPolicyForEdition(raw);
  if (policy === null) return null;
  if (policy === "requisition_first") return "govt";
  return (raw ?? "").trim().toLowerCase() === "psu" ? "psu" : "small_office";
}

/** No stored row == Small Office == today's behaviour (direct creation allowed). */
export const DEFAULT_POLICY: EditionPolicy = { edition: "small_office", requireRequisition: null };

/** The catalogue `recruitmentPolicy` default (requisition_first for govt, direct otherwise); an explicit per-tenant override wins. */
export function requisitionRequired(p: EditionPolicy | null | undefined): boolean {
  const policy = p ?? DEFAULT_POLICY;
  if (policy.requireRequisition !== null) return policy.requireRequisition;
  return recruitmentPolicyForEdition(policy.edition) === "requisition_first";
}

export const REQUISITION_REQUIRED_MESSAGE =
  "this edition requires every vacancy to originate from a fully approved requisition; "
  + "create and approve a requisition, then publish it (POST /v1/hrms/requisitions/:id/publish)";
