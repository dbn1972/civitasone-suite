/**
 * Estab PII policy (booking + citizen-lease) on the shared
 * @civitasone/data-governance engine.
 *
 * Applicant / tenant / transferee phone, email and Aadhaar are masked in every
 * response unless the caller holds a PII-authorised role, and each unmasked
 * reveal is audited (audit.event.record, action `pii_revealed`) via the outbox.
 */
import { applyMasking, maskValue, type MaskingPolicy } from "@civitasone/data-governance";
import type { RequestContext } from "@civitasone/types";
import { hasAnyRole } from "@civitasone/auth";
import { db } from "./db.js";
import { enqueue } from "./outbox.js";

/** Officer roles that administer the tenant's records. */
export const ESTAB_ADMIN_ROLES = ["estab_officer", "estab_admin", "super_admin"];
/** Roles that may see phone/email/Aadhaar unmasked (reveal is audited). */
export const ESTAB_PII_ROLES = ESTAB_ADMIN_ROLES;

const phone = (v: unknown) => maskValue(v, "partial4");
const email = (v: unknown) => maskValue(v, "email");
const aadhaar = (v: unknown) => maskValue(v, "partial4");

export const ESTAB_PII_POLICY: MaskingPolicy = {
  applicantPhone: { strategy: phone, allowRoles: ESTAB_PII_ROLES },
  applicantEmail: { strategy: email, allowRoles: ESTAB_PII_ROLES },
  tenantPhone: { strategy: phone, allowRoles: ESTAB_PII_ROLES },
  tenantAadhaar: { strategy: aadhaar, allowRoles: ESTAB_PII_ROLES },
  transfereePhone: { strategy: phone, allowRoles: ESTAB_PII_ROLES },
  transfereeAadhaar: { strategy: aadhaar, allowRoles: ESTAB_PII_ROLES },
};

export function maskEstabRecord<T extends Record<string, unknown>>(record: T, ctx: RequestContext): T {
  return applyMasking(record, ESTAB_PII_POLICY, ctx.roles);
}

/**
 * Mask a read result for the caller. When the caller is PII-authorised and the
 * rows carry PII fields, the reveal is audited in the outbox.
 */
export async function maskAndAuditRead<T extends Record<string, unknown>>(
  ctx: RequestContext, resourceType: string, rows: T[],
): Promise<T[]> {
  if (!hasAnyRole(ctx, ESTAB_PII_ROLES)) return rows.map((r) => maskEstabRecord(r, ctx));
  const fields = Object.keys(ESTAB_PII_POLICY);
  const revealed = rows.filter((r) => fields.some((f) => r[f] != null));
  if (revealed.length > 0) {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          service: "estab", action: "pii_revealed", resourceType,
          resourceId: revealed.length === 1 ? String(revealed[0]!.id) : "list",
          resourceIds: revealed.map((r) => String(r.id)), outcome: "success",
        },
      });
    });
  }
  return rows;
}
