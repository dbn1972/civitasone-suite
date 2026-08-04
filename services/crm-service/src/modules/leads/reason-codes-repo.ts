/**
 * LQ-004 persistence for lifecycle reason codes (lazy-seeded defaults) + validation.
 * Admin PUT is synchronous + transactionally audited (the dedup-rules pattern).
 */
import { eq, and, asc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { leadReasonCodes, type LeadReasonCodeRow } from "./reason-codes-schema.js";

const AUDIT_TOPIC = "audit.event.record";

/** Target statuses that require a reason code (LQ-004). Includes the re-open targets. */
export const REASON_CODE_STATUSES = ["nurture", "recycled", "disqualified", "new", "qualified"] as const;

export interface ReasonCodeSeed {
  code: string;
  label: string;
  appliesToStatus: string;
}

/** Sensible per-tenant defaults, seeded lazily on first read. */
export const DEFAULT_REASON_CODES: readonly ReasonCodeSeed[] = [
  { code: "not_ready", label: "Not ready to buy", appliesToStatus: "nurture" },
  { code: "awaiting_budget", label: "Awaiting budget", appliesToStatus: "nurture" },
  { code: "needs_nurturing", label: "Needs more nurturing", appliesToStatus: "nurture" },
  { code: "budget_not_approved", label: "Budget not approved", appliesToStatus: "recycled" },
  { code: "timing_not_right", label: "Timing not right", appliesToStatus: "recycled" },
  { code: "reengage_later", label: "Re-engage later", appliesToStatus: "recycled" },
  { code: "not_a_fit", label: "Not a fit", appliesToStatus: "disqualified" },
  { code: "no_budget", label: "No budget", appliesToStatus: "disqualified" },
  { code: "no_response", label: "No response", appliesToStatus: "disqualified" },
  { code: "duplicate", label: "Duplicate record", appliesToStatus: "disqualified" },
  { code: "reopened_new_info", label: "Re-opened — new information", appliesToStatus: "new" },
  { code: "reopened_qualified", label: "Re-opened — re-qualified", appliesToStatus: "qualified" },
] as const;

export interface ReasonCodeView {
  id: string;
  code: string;
  label: string;
  appliesToStatus: string;
  active: boolean;
  version: number;
}
function toView(r: LeadReasonCodeRow): ReasonCodeView {
  return { id: r.id, code: r.code, label: r.label, appliesToStatus: r.appliesToStatus, active: r.active, version: r.version };
}

async function seedDefaults(tenantId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const d of DEFAULT_REASON_CODES) {
      await tx.insert(leadReasonCodes).values({
        tenantId,
        code: d.code,
        label: d.label,
        appliesToStatus: d.appliesToStatus,
        active: true,
        createdBy: actorId,
        updatedBy: actorId,
      }).onConflictDoNothing();
    }
  });
}

/** The tenant's reason codes, lazy-seeding the defaults on first read. */
export async function getCodes(tenantId: string, actorId: string): Promise<ReasonCodeView[]> {
  const existing = await scopedRead((tx) =>
    tx.select().from(leadReasonCodes).where(eq(leadReasonCodes.tenantId, tenantId)).orderBy(asc(leadReasonCodes.appliesToStatus)),
  );
  if (existing.length > 0) return existing.map(toView);
  await seedDefaults(tenantId, actorId);
  const seeded = await scopedRead((tx) =>
    tx.select().from(leadReasonCodes).where(eq(leadReasonCodes.tenantId, tenantId)).orderBy(asc(leadReasonCodes.appliesToStatus)),
  );
  return seeded.map(toView);
}

/**
 * Is `code` a valid, active reason code for a transition to `targetStatus`?
 * Seeds defaults first so a brand-new tenant can transition immediately.
 */
export async function isValidCode(tenantId: string, actorId: string, targetStatus: string, code: string): Promise<boolean> {
  await getCodes(tenantId, actorId); // ensure seeded
  const rows = await scopedRead((tx) =>
    tx.select({ id: leadReasonCodes.id }).from(leadReasonCodes)
      .where(and(
        eq(leadReasonCodes.tenantId, tenantId),
        eq(leadReasonCodes.appliesToStatus, targetStatus),
        eq(leadReasonCodes.code, code),
        eq(leadReasonCodes.active, true),
      ))
      .limit(1),
  );
  return rows.length > 0;
}

export interface ReasonCodeUpsert {
  code: string;
  label: string;
  appliesToStatus: string;
  active: boolean;
}

/** Upsert reason codes by (tenant, status, code); a partial PUT is additive. Audited. */
export async function upsertCodes(
  tenantId: string,
  codes: ReasonCodeUpsert[],
  actorId: string,
  correlationId: string,
): Promise<ReasonCodeView[]> {
  // Ensure the built-in defaults exist even when a tenant's very first interaction
  // with the catalog is a custom PUT (idempotent — ON CONFLICT DO NOTHING), so
  // adding a custom code never leaves the default codes unavailable for transitions.
  await seedDefaults(tenantId, actorId);
  await db.transaction(async (tx) => {
    for (const c of codes) {
      await tx.insert(leadReasonCodes).values({
        tenantId,
        code: c.code,
        label: c.label,
        appliesToStatus: c.appliesToStatus,
        active: c.active,
        createdBy: actorId,
        updatedBy: actorId,
      }).onConflictDoUpdate({
        target: [leadReasonCodes.tenantId, leadReasonCodes.appliesToStatus, leadReasonCodes.code],
        set: {
          label: c.label,
          active: c.active,
          updatedAt: new Date(),
          updatedBy: actorId,
          version: sql`${leadReasonCodes.version} + 1`,
        },
      });
    }
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId,
      actorId,
      correlationId,
      payload: {
        service: "crm",
        action: "lead_reason_codes_update",
        resourceType: "lead_reason_code",
        resourceId: tenantId,
        outcome: "success",
        metadata: { codeCount: codes.length },
      },
    });
  });
  return getCodes(tenantId, actorId);
}
