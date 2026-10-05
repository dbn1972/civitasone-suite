/**
 * F1 — Server-side PII masking + audited reveal.
 *
 * The SERVER is the authority for PII redaction on the citizen-facing CRM
 * modules (grievances, RTI, service-requests, onboarding). List + detail GETs
 * mask the sensitive fields for callers whose roles are outside that
 * resource's PII-read set; a role inside the set receives the clear value.
 * The raw value never leaves the server for an unprivileged caller.
 *
 * A single audited reveal path (`POST /v1/crm/pii/reveal`) returns one clear
 * field at a time to an authorised caller and writes a `pii_reveal` audit event
 * in the same transaction as the read. Audit payloads carry ids/field
 * names/reasons only — never the PII value.
 *
 * This mirrors shared/data-governance.ts (CONTACT_PII_ROLES + the shared
 * @civitasone/data-governance engine) and reuses crm's canonical maskEmail /
 * maskPhone so the masked wire format matches the contacts module exactly.
 */
import { applyMasking, type MaskingPolicy, type MaskFn } from "@civitasone/data-governance";
import { maskEmail, maskPhone } from "./pii-crypto.js";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";

/**
 * PII-read role sets, mirrored from the web's lib/auth/roleGuard.ts
 * (CRM_PII_READ_ROLES) and shared/data-governance.ts (CONTACT_PII_ROLES).
 * The onboarding KYC reference is governed by the stricter KYC-approver set,
 * matching onboarding/routes.ts KYC_APPROVER_ROLES.
 */
export const CRM_PII_READ_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];
export const KYC_APPROVER_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/** True when the caller may see this resource's PII in the clear. */
export function canReadPii(resourceType: ResourceType, roles: string[]): boolean {
  const allow = resourceType === "onboarding" ? KYC_APPROVER_ROLES : CRM_PII_READ_ROLES;
  return allow.some((r) => roles.includes(r));
}

/**
 * Partial name mask for RTI applicants: keep the first word intact and the
 * first letter of the next word, bullet the rest ("Anil Sharma" -> "Anil S•••").
 * A single-word name keeps the first letter only ("Anil" -> "A•••"). Pure.
 */
export function maskName(value: string | null): string | null {
  if (!value) return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    const w = parts[0]!;
    return `${w.slice(0, 1)}•••`;
  }
  const first = parts[0]!;
  const second = parts[1]!;
  return `${first} ${second.slice(0, 1)}•••`;
}

/**
 * Mask an opaque reference keeping only the last 4 characters
 * ("KYC-ABCD1234" -> "••••1234"). Values of 4 chars or fewer are fully masked.
 */
export function maskLast4(value: string | null): string | null {
  if (!value) return value;
  const v = value.trim();
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

/**
 * Mask a free-form contact string. If it looks like an email, use the email
 * strategy; otherwise treat it as a phone/handle and keep the last 4.
 */
export function maskContact(value: string | null): string | null {
  if (!value) return value;
  return value.includes("@") ? maskEmail(value) : maskPhone(value);
}

const emailStrategy: MaskFn = (v) => maskEmail(v as string | null);
const phoneStrategy: MaskFn = (v) => maskPhone(v as string | null);
const nameStrategy: MaskFn = (v) => maskName(v as string | null);
const contactStrategy: MaskFn = (v) => maskContact(v as string | null);
const last4Strategy: MaskFn = (v) => maskLast4(v as string | null);

/** F1-01 grievances: mask citizen phone + email. */
export const GRIEVANCE_MASKING_POLICY: MaskingPolicy = {
  citizenPhone: { strategy: phoneStrategy, allowRoles: CRM_PII_READ_ROLES },
  citizenEmail: { strategy: emailStrategy, allowRoles: CRM_PII_READ_ROLES },
};

/** F1-02 RTI: partial-mask applicant name + mask applicant contact. */
export const RTI_MASKING_POLICY: MaskingPolicy = {
  applicantName: { strategy: nameStrategy, allowRoles: CRM_PII_READ_ROLES },
  applicantContact: { strategy: contactStrategy, allowRoles: CRM_PII_READ_ROLES },
};

/** F1-04 service requests: mask citizen phone + email. */
export const SERVICE_REQUEST_MASKING_POLICY: MaskingPolicy = {
  citizenPhone: { strategy: phoneStrategy, allowRoles: CRM_PII_READ_ROLES },
  citizenEmail: { strategy: emailStrategy, allowRoles: CRM_PII_READ_ROLES },
};

/** F1-03 onboarding: mask kyc reference (last 4) except for KYC approvers. */
export const ONBOARDING_MASKING_POLICY: MaskingPolicy = {
  kycReference: { strategy: last4Strategy, allowRoles: KYC_APPROVER_ROLES },
};

export type ResourceType = "grievance" | "rti" | "service_request" | "onboarding" | "contact";

/** The masking policy to apply for a resource type. */
export function policyFor(resourceType: ResourceType): MaskingPolicy {
  switch (resourceType) {
    case "grievance":
      return GRIEVANCE_MASKING_POLICY;
    case "rti":
      return RTI_MASKING_POLICY;
    case "service_request":
      return SERVICE_REQUEST_MASKING_POLICY;
    case "onboarding":
      return ONBOARDING_MASKING_POLICY;
    case "contact":
      return {
        email: { strategy: emailStrategy, allowRoles: CRM_PII_READ_ROLES },
        phone: { strategy: phoneStrategy, allowRoles: CRM_PII_READ_ROLES },
      };
  }
}

/** Mask one record per the resource's policy for a caller with `roles`. */
export function maskRecord<T extends Record<string, unknown>>(
  resourceType: ResourceType,
  record: T,
  roles: string[] = [],
): T {
  return applyMasking(record, policyFor(resourceType), roles);
}

/** Mask every record in a list per the resource's policy. */
export function maskList<T extends Record<string, unknown>>(
  resourceType: ResourceType,
  records: T[],
  roles: string[] = [],
): T[] {
  return records.map((r) => maskRecord(resourceType, r, roles));
}

/**
 * The set of fields that can be revealed per resource type, mapped to the DB
 * column that holds the clear value. Guards the reveal endpoint so an attacker
 * cannot name an arbitrary column.
 */
export const REVEALABLE_FIELDS: Record<ResourceType, Record<string, string>> = {
  grievance: { citizenPhone: "citizen_phone", citizenEmail: "citizen_email" },
  rti: { applicantName: "applicant_name", applicantContact: "applicant_contact" },
  service_request: { citizenPhone: "citizen_phone", citizenEmail: "citizen_email" },
  onboarding: { kycReference: "kyc_reference" },
  contact: { email: "email", phone: "phone" },
};

/** Roles allowed to reveal this resource type (single source for route + tests). */
export function revealRolesFor(resourceType: ResourceType): string[] {
  return resourceType === "onboarding" ? KYC_APPROVER_ROLES : CRM_PII_READ_ROLES;
}

/** Audit roles helper so the route and tests share one source of truth. */
export function assertCanReveal(resourceType: ResourceType, ctx: RequestContext): boolean {
  const allow = resourceType === "onboarding" ? KYC_APPROVER_ROLES : CRM_PII_READ_ROLES;
  return hasAnyRole(ctx, allow);
}
