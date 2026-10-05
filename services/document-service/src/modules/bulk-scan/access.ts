/**
 * Who may do what on scanned documents.
 *
 * Reviewer / operator actions and bulk-scan reads: document_admin | super_admin (BULK_SCAN_ROLES, the same
 * constants as every other bulk-scan route). There is deliberately NO generic `document_user` access: a
 * scanned service book or voucher can carry HR / finance PII, so a document-wide reader role does not imply it.
 *
 * Downloading a FILED document additionally allows the roles that can already see the LINKED target record,
 * but only when the document has an ACTIVE (state `linked`) link to a target of that kind.
 */
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import type { LinkTarget } from "@civitasone/scan-link";
import { BULK_SCAN_ROLES } from "./http.js";

export const DOCUMENT_ROLES: readonly string[] = BULK_SCAN_ROLES;

/** Roles that may see the linked target record (HR employee file, finance record, eOffice file). */
export const TARGET_READ_ROLES: Readonly<Record<LinkTarget, readonly string[]>> = {
  hr_employee: ["hr_admin", "hr_officer"],
  finance_payment: ["finance_officer", "finance_admin", "audit_officer"],
  finance_voucher: ["finance_officer", "finance_admin", "audit_officer"],
  finance_bill: ["finance_officer", "finance_admin", "audit_officer"],
  eoffice_file: ["estab_officer", "estab_admin", "estab_deputy_secretary", "audit_officer"],
};

export function hasDocumentRole(ctx: Pick<RequestContext, "roles">): boolean {
  return hasAnyRole(ctx as RequestContext, [...DOCUMENT_ROLES]);
}

/** Download / page-image permission: document role, or a target-record role matching an active link's target. */
export function canReadFiledDocument(
  ctx: Pick<RequestContext, "roles">,
  activeLinkTargets: readonly LinkTarget[],
): boolean {
  if (hasDocumentRole(ctx)) return true;
  return activeLinkTargets.some((t) => hasAnyRole(ctx as RequestContext, [...TARGET_READ_ROLES[t]]));
}
