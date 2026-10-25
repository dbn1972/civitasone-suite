import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { approvalLevels } from "./schema.js";
import { MAX_APPROVAL_LEVELS } from "./domain.js";

const log = pino({ name: "contract-approvals-consumer" });

const AUDIT_TOPIC = "audit.event.record";

async function audit(tx: unknown, msg: any, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType: "approval_level", resourceId, outcome: "success" },
  });
}

export function registerApprovalConsumers(q: Queue): void {
  q.subscribe(COMMANDS.approvalLevelCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; minValuePaise: string;
      requiredRole: string; label: string; ordinal: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // CLOS3-S4-04: the route decided the cap and the ordinal from a read taken before publish, so
      // concurrent creates all saw the same count. Decide here instead, serialised per tenant:
      // the advisory lock is held to the end of this transaction, so the recount below sees every
      // earlier create. The supplied p.ordinal is ignored in favour of max(ordinal)+1.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"approval-levels:" + msg.tenantId}))`);
      const [agg] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          maxOrdinal: sql<number>`coalesce(max(${approvalLevels.ordinal}), 0)::int`,
        })
        .from(approvalLevels)
        .where(eq(approvalLevels.tenantId, msg.tenantId));
      if ((agg?.count ?? 0) >= MAX_APPROVAL_LEVELS) {
        // Terminal outcome (not retryable): drop the command and leave an audit trail.
        log.warn({ event: "level_limit_reached", messageId: msg.messageId, tenantId: msg.tenantId }, "approval level create dropped: limit reached");
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "contract", action: "create", resourceType: "approval_level", resourceId: p.id,
            outcome: "failed", reason: `LEVEL_LIMIT_REACHED (max ${MAX_APPROVAL_LEVELS})`,
          },
        });
        return;
      }

      await tx.insert(approvalLevels).values({
        id: p.id,
        tenantId: msg.tenantId,
        minValuePaise: BigInt(p.minValuePaise),
        requiredRole: p.requiredRole,
        label: p.label ?? "",
        ordinal: (agg?.maxOrdinal ?? 0) + 1,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.approvalLevelCreated, eventType: EVENTS.approvalLevelCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, requiredRole: p.requiredRole },
      });
      await audit(tx, msg, "create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "approval-level", "list"));
  });

  q.subscribe(COMMANDS.approvalLevelUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; version: number;
      minValuePaise?: string; requiredRole?: string; label?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: p.version + 1,
      };
      if (p.minValuePaise !== undefined) updates.minValuePaise = BigInt(p.minValuePaise);
      if (p.requiredRole !== undefined) updates.requiredRole = p.requiredRole;
      if (p.label !== undefined) updates.label = p.label;

      const [updated] = await tx
        .update(approvalLevels)
        .set(updates as any)
        .where(
          and(
            eq(approvalLevels.id, p.id),
            eq(approvalLevels.tenantId, msg.tenantId),
            eq(approvalLevels.version, p.version),
          ),
        )
        .returning();

      if (!updated) {
        log.warn({ event: "version_conflict_or_missing", messageId: msg.messageId, tenantId: msg.tenantId }, "approval level update skipped (no row or version mismatch)");
        return;
      }

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.approvalLevelUpdated, eventType: EVENTS.approvalLevelUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, version: p.version + 1 },
      });
      await audit(tx, msg, "update", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "approval-level", p.id));
  });

  q.subscribe(COMMANDS.approvalLevelDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const result = await tx
        .delete(approvalLevels)
        .where(and(eq(approvalLevels.id, p.id), eq(approvalLevels.tenantId, msg.tenantId)))
        .returning();

      if (result.length === 0) return;

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.approvalLevelDeleted, eventType: EVENTS.approvalLevelDeleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId },
      });
      await audit(tx, msg, "delete", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "approval-level", p.id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "approval-level", "list"));
  });
}
