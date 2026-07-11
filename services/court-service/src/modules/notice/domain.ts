/**
 * notice pure domain — the notice lifecycle + delivery-status state machines and
 * id derivation (§21 issuance & service of process). No I/O — every function here
 * is deterministic and side-effect free so it is trivially unit-testable and safe
 * to call from both the command and consumer paths.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

export const NOTICE_STATUSES = ["issued", "served", "unserved", "cancelled"] as const;
export type NoticeStatus = typeof NOTICE_STATUSES[number];

export const DELIVERY_STATUSES = ["pending", "served", "unserved", "refused"] as const;
export type DeliveryStatus = typeof DELIVERY_STATUSES[number];

/** An issued notice can be marked served, unserved, or cancelled. Those three are
 *  terminal for the notice row. */
const NOTICE_TRANSITIONS: Record<NoticeStatus, NoticeStatus[]> = {
  issued:    ["served", "unserved", "cancelled"],
  served:    [],
  unserved:  [],
  cancelled: [],
};

export function canTransition(from: NoticeStatus, to: NoticeStatus): boolean {
  return NOTICE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertNoticeTransition(from: string, to: NoticeStatus): void {
  if (!canTransition(from as NoticeStatus, to)) {
    throw new Error(`INVALID_NOTICE_TRANSITION: cannot move notice from '${from}' to '${to}'`);
  }
}

/** A pending service attempt can resolve to served, unserved, or refused. Those
 *  three are terminal for the attempt. */
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending:  ["served", "unserved", "refused"],
  served:   [],
  unserved: [],
  refused:  [],
};

export function canDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertDeliveryTransition(from: string, to: DeliveryStatus): void {
  if (!canDeliveryTransition(from as DeliveryStatus, to)) {
    throw new Error(`INVALID_DELIVERY_TRANSITION: cannot move delivery from '${from}' to '${to}'`);
  }
}

/** A notice id is deterministic on (tenant + case + type + issue date) so
 *  re-submitting the SAME notice is idempotent end-to-end. */
export function deriveNoticeId(
  tenantId: string, caseId: string, noticeType: string, issueDateIso: string,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:notice:${caseId}:${noticeType}:${issueDateIso}`,
  );
}

/** A service-attempt id is deterministic on (tenant + notice + mode + sequence)
 *  so a redelivery of the same attempt is a no-op. */
export function deriveServiceId(
  tenantId: string, noticeId: string, mode: string, seq: number,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:notice-service:${noticeId}:${mode}:${seq}`,
  );
}

/** Substitute {{key}} tokens in a template with vars[key] (missing → ""). No
 * code evaluation — a plain, safe string replace. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/** Render a notice body from a notice_template config value (§47), or null when
 * the tenant has no template for this notice type. Config shape: { template }. */
export function renderNoticeBody(configValue: unknown, vars: Record<string, string>): string | null {
  if (configValue && typeof configValue === "object") {
    const tpl = (configValue as Record<string, unknown>).template;
    if (typeof tpl === "string" && tpl.length > 0) return renderTemplate(tpl, vars);
  }
  return null;
}
