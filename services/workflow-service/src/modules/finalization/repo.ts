import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { randomUUID } from "node:crypto";
import { EVENTS } from "../../topics.js";
import { instanceFinalizations, type InstanceFinalizationRow } from "./schema.js";
import { instances } from "../instances/schema.js";
import type { FinalizationState, ImpactAssessment } from "./domain.js";

export function toState(r: InstanceFinalizationRow | null): FinalizationState | null {
  if (!r) return null;
  return {
    instanceId: r.instanceId,
    finalized: true,
    finalizedBy: r.finalizedBy,
    finalizedAt: r.finalizedAt.toISOString(),
    reversed: r.reversed,
    reversedBy: r.reversedBy ?? null,
    reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
  };
}

export async function findByInstance(instanceId: string, tenantId: string): Promise<InstanceFinalizationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(instanceFinalizations)
    .where(and(eq(instanceFinalizations.instanceId, instanceId), eq(instanceFinalizations.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/**
 * Finalize an instance: the instance must exist, be tenant-scoped and not
 * already finalized (unique(instance_id) is the backstop). Emits a finalized
 * event via the outbox. Returns null when the instance is missing.
 */
export async function finalize(
  tenantId: string, instanceId: string, actorId: string, correlationId: string,
): Promise<InstanceFinalizationRow | null | { conflict: true }> {
  return db.transaction(async (tx) => {
    const inst = await tx.select({ id: instances.id }).from(instances)
      .where(and(eq(instances.id, instanceId), eq(instances.tenantId, tenantId))).limit(1);
    if (!inst[0]) return null;
    const existing = await tx.select().from(instanceFinalizations)
      .where(eq(instanceFinalizations.instanceId, instanceId)).limit(1);
    if (existing[0]) return { conflict: true as const };
    const rows = await tx.insert(instanceFinalizations)
      .values({ tenantId, instanceId, finalizedBy: actorId })
      .returning();
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.instanceFinalized, eventType: EVENTS.instanceFinalized,
      tenantId, actorId, correlationId: correlationId || randomUUID(),
      payload: { instanceId, finalizedBy: actorId },
    });
    return rows[0]!;
  });
}

/**
 * Reverse (unfinalize) a finalized instance. The reversal guard is enforced by
 * the caller (authority + reason + dependency check via the pure domain); this
 * write flips `reversed`, stores the reason + impact, and emits a reversal
 * event. CAS on reversed=false so a concurrent reversal can't double-apply.
 */
export async function reverse(
  tenantId: string, instanceId: string, actorId: string, reason: string,
  impact: ImpactAssessment, correlationId: string,
): Promise<InstanceFinalizationRow | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.update(instanceFinalizations)
      .set({
        reversed: true, reversedBy: actorId, reversedAt: new Date(),
        reversalReason: reason, impact: impact as unknown as Record<string, unknown>, updatedAt: new Date(),
      })
      .where(and(
        eq(instanceFinalizations.instanceId, instanceId),
        eq(instanceFinalizations.tenantId, tenantId),
        eq(instanceFinalizations.reversed, false),
      ))
      .returning();
    if (!rows[0]) return null;
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.instanceReversed, eventType: EVENTS.instanceReversed,
      tenantId, actorId, correlationId: correlationId || randomUUID(),
      payload: { instanceId, reversedBy: actorId, reason, impact: impact as unknown as Record<string, unknown> },
    });
    return rows[0];
  });
}
