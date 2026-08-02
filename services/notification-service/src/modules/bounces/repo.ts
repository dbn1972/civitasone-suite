/**
 * INT-12 — bounce/suppression reads and writes.
 *
 * Every lookup goes through the blind index (`recipientHash`), never through the
 * encrypted `recipient` column: ciphertext is non-deterministic so equality on
 * it can never match.
 */
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import { blindIndex } from "../../shared/pii-crypto.js";
import {
  bounceEvents,
  suppressionList,
  suppressionSettings,
  type BounceEventInsert,
  type SuppressionInsert,
  type SuppressionRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertBounceEvent(tx: Writer, row: BounceEventInsert): Promise<void> {
  await tx.insert(bounceEvents).values(row);
}

/** Soft-bounce total for a recipient within the tenant (blind-index lookup). */
export async function countSoftBounces(
  tx: Writer, tenantId: string, recipientHash: string,
): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bounceEvents)
    .where(and(
      eq(bounceEvents.tenantId, tenantId),
      eq(bounceEvents.recipientHash, recipientHash),
      eq(bounceEvents.classification, "soft"),
    ));
  return rows[0]?.n ?? 0;
}

/** Per-tenant soft-bounce threshold override, or null when unset. */
export async function findThresholdSetting(
  tx: Writer, tenantId: string,
): Promise<number | null> {
  const rows = await tx
    .select({ threshold: suppressionSettings.softBounceThreshold })
    .from(suppressionSettings)
    .where(eq(suppressionSettings.tenantId, tenantId))
    .limit(1);
  return rows[0]?.threshold ?? null;
}

/**
 * Add (or refresh) a suppression entry. Idempotent on (tenant_id,
 * recipient_hash) — a repeated hard bounce updates the reason rather than
 * inserting a duplicate, and re-suppressing a previously released recipient
 * clears released_at.
 */
export async function upsertSuppression(
  tx: Writer, row: SuppressionInsert,
): Promise<void> {
  await tx.insert(suppressionList).values(row).onConflictDoUpdate({
    target: [suppressionList.tenantId, suppressionList.recipientHash],
    set: {
      reason: row.reason,
      source: row.source ?? "bounce",
      softBounceCount: row.softBounceCount ?? 0,
      releasedAt: null,
      suppressedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: row.updatedBy,
    },
  });
}

/**
 * Is this recipient currently suppressed for the tenant? Runs inside the
 * caller's transaction so the send path cannot bypass it.
 */
export async function isSuppressed(
  tx: Writer, tenantId: string, recipient: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(and(
      eq(suppressionList.tenantId, tenantId),
      eq(suppressionList.recipientHash, blindIndex(recipient)),
      isNull(suppressionList.releasedAt),
    ))
    .limit(1);
  return rows.length > 0;
}

/** Release (un-suppress) an entry. Soft state change — the row is kept for audit. */
export async function releaseSuppression(
  tx: Writer, tenantId: string, id: string, actorId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ version: suppressionList.version })
    .from(suppressionList)
    .where(and(eq(suppressionList.tenantId, tenantId), eq(suppressionList.id, id)))
    .limit(1);
  const current = rows[0];
  if (!current) return false;
  await tx.update(suppressionList).set({
    releasedAt: new Date(),
    updatedAt: new Date(),
    updatedBy: actorId,
    version: current.version + 1,
  }).where(and(eq(suppressionList.tenantId, tenantId), eq(suppressionList.id, id)));
  return true;
}

export type SuppressionView = {
  id: string;
  channel: string;
  reason: string;
  source: string;
  softBounceCount: number;
  suppressedAt: string;
  releasedAt: string | null;
};

/**
 * List suppression entries. The cleartext recipient is deliberately NOT
 * returned: the caller already knows who they looked up, and an admin list
 * endpoint is not a reason to re-expose a PII column in a JSON body.
 */
export async function listSuppressions(
  tenantId: string, limit: number, offset: number, activeOnly: boolean,
): Promise<{ rows: SuppressionView[]; total: number }> {
  return readScoped(tenantId, async (tx) => {
    const where = activeOnly
      ? and(eq(suppressionList.tenantId, tenantId), isNull(suppressionList.releasedAt))
      : eq(suppressionList.tenantId, tenantId);
    const rows = await tx.select().from(suppressionList).where(where)
      .orderBy(desc(suppressionList.suppressedAt))
      .limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` })
      .from(suppressionList).where(where);
    return {
      rows: rows.map(toView),
      total: counted[0]?.n ?? 0,
    };
  });
}

/** Suppression status for one recipient — used by the check endpoint. */
export async function checkSuppression(
  tenantId: string, recipient: string,
): Promise<SuppressionView | null> {
  const hash = blindIndex(recipient);
  const rows = await readScoped(tenantId, (tx) =>
    tx.select().from(suppressionList)
      .where(and(
        eq(suppressionList.tenantId, tenantId),
        eq(suppressionList.recipientHash, hash),
        isNull(suppressionList.releasedAt),
      ))
      .limit(1),
  );
  const row = rows[0];
  return row ? toView(row) : null;
}

function toView(row: SuppressionRow): SuppressionView {
  return {
    id: row.id,
    channel: row.channel,
    reason: row.reason,
    source: row.source,
    softBounceCount: row.softBounceCount,
    suppressedAt: row.suppressedAt.toISOString(),
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
  };
}
