/**
 * notice pure domain — the notice lifecycle + delivery-status state machines and
 * id derivation (§21 issuance & service of process). No I/O — every function here
 * is deterministic and side-effect free so it is trivially unit-testable and safe
 * to call from both the command and consumer paths.
 */
import { createHash } from "node:crypto";
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
 *  re-submitting the SAME notice is idempotent end-to-end.
 *
 *  KNOWN LIMITATION (theoretical, not fixed here — see PR description): because
 *  there is no further disambiguator, two DISTINCT notices of the same type on
 *  the same case on the same calendar date collide onto one id (e.g. two
 *  respondents each served a "summons" the same day would produce the same
 *  noticeId, and the second insert would be silently dropped by
 *  onConflictDoNothing). Judged lower priority than the recordService fix below
 *  and left alone here: changing this id's shape needs more care, since existing
 *  notice ids are already persisted and may be read elsewhere. */
export function deriveNoticeId(
  tenantId: string, caseId: string, noticeType: string, issueDateIso: string,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:notice:${caseId}:${noticeType}:${issueDateIso}`,
  );
}

/** A service-attempt id is deterministic on (tenant + notice + mode + seq) so a
 *  redelivery of the same attempt is a no-op. seq is normally
 *  hashServiceContent(...) below (a content hash of the attempt's fields), so a
 *  genuine retry — identical content — always derives the same seq and therefore
 *  the same serviceId, and dedupes via onConflictDoNothing; a plain numeric
 *  sequence is still accepted for a caller with its own sequencing scheme. */
export function deriveServiceId(
  tenantId: string, noticeId: string, mode: string, seq: number | string,
): string {
  return deterministicId(
    COURT_NAMESPACE,
    `${tenantId}:notice-service:${noticeId}:${mode}:${seq}`,
  );
}

/**
 * Content-derived disambiguator for a service attempt - a SHA-256 hex digest over
 * every field that distinguishes one attempt from another (the full
 * recordServiceBody shape: serviceMode, recipient, dispatchRef, deliveryStatus,
 * servedAt, proof). An identical resubmission (a genuine retry) hashes to the SAME
 * value and therefore the same serviceId, so it dedupes via onConflictDoNothing
 * instead of creating a duplicate service-attempt row.
 *
 * The fields are combined via JSON.stringify (not a plain string join): each
 * element is individually quoted/escaped, so a free-text field (recipient, proof)
 * containing arbitrary characters can never shift across a field boundary and
 * collide with a differently-split input.
 *
 * USED ONLY AS A FALLBACK (see recordService in commands.ts, which prefers a
 * caller-supplied x-idempotency-key via idempotentId() when present) — KNOWN
 * TRADEOFF: two GENUINELY DISTINCT service attempts that happen to share every
 * one of these fields byte-for-byte (e.g. two separate "post to Respondent 1,
 * pending" attempts logged days apart, with no other detail yet recorded) hash
 * identically and collapse onto one row. A caller that needs two such attempts
 * to both persist should send a distinct x-idempotency-key per attempt instead
 * of relying on this fallback.
 */
export function hashServiceContent(
  serviceMode: string,
  recipient: string | undefined,
  dispatchRef: string | undefined,
  deliveryStatus: string | undefined,
  servedAt: string | undefined,
  proof: string | undefined,
): string {
  const content = JSON.stringify([
    serviceMode, recipient ?? null, dispatchRef ?? null, deliveryStatus ?? null, servedAt ?? null, proof ?? null,
  ]);
  return createHash("sha256").update(content, "utf8").digest("hex");
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
