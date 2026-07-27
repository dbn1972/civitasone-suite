import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { esignRoutes, type SignatoryEntry } from "./schema.js";
import { validateSignatories, canSign, applySignature, checkDeadlineStatus } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

async function audit(tx: unknown, msg: any, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType: "esign", resourceId, outcome: "success" },
  });
}

export function registerEsignConsumers(q: Queue): void {
  q.subscribe(COMMANDS.esignCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractId: string; ownerId: string;
      signatories: Array<{ userId: string; ordinal: number; deadlineDays: number }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const signatories: SignatoryEntry[] = p.signatories.map((s) => ({
        userId: s.userId,
        ordinal: s.ordinal,
        deadlineDays: s.deadlineDays,
        status: "pending" as const,
        signedAt: null,
      }));

      await tx.insert(esignRoutes).values({
        id: p.id,
        tenantId: msg.tenantId,
        contractId: p.contractId,
        signatories,
        currentOrdinal: 1,
        status: "in_progress",
        ownerId: p.ownerId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.esignCreated, eventType: EVENTS.esignCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, contractId: p.contractId, signatoryCount: signatories.length },
      });
      await audit(tx, msg, "create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "esign_route", p.id));
  });

  q.subscribe(COMMANDS.esignSign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; userId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [route] = await tx
        .select()
        .from(esignRoutes)
        .where(and(eq(esignRoutes.id, p.id), eq(esignRoutes.tenantId, msg.tenantId)))
        .limit(1);
      if (!route || route.status !== "in_progress") return;

      const signatories = route.signatories as SignatoryEntry[];
      if (!canSign(signatories, route.currentOrdinal, p.userId)) return;

      const signedAt = new Date().toISOString();
      const result = applySignature(signatories, route.currentOrdinal, p.userId, signedAt);
      const newStatus = result.isComplete ? "completed" : "in_progress";

      const [updated] = await tx
        .update(esignRoutes)
        .set({
          signatories: result.signatories,
          currentOrdinal: result.newOrdinal,
          status: newStatus,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: route.version + 1,
        } as any)
        .where(
          and(
            eq(esignRoutes.id, p.id),
            eq(esignRoutes.tenantId, msg.tenantId),
            eq(esignRoutes.version, route.version),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.esignSigned, eventType: EVENTS.esignSigned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: msg.tenantId, contractId: route.contractId, userId: p.userId, ordinal: route.currentOrdinal },
      });

      if (result.isComplete) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.esignCompleted, eventType: EVENTS.esignCompleted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: msg.tenantId, contractId: route.contractId },
        });
      }

      await audit(tx, msg, "sign", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "esign_route", p.id));
  });

  q.subscribe(COMMANDS.esignCheckDeadline, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [route] = await tx
        .select()
        .from(esignRoutes)
        .where(and(eq(esignRoutes.id, p.id), eq(esignRoutes.tenantId, msg.tenantId)))
        .limit(1);
      if (!route || route.status !== "in_progress") return;

      const signatories = route.signatories as SignatoryEntry[];
      const deadlineStatus = checkDeadlineStatus(
        signatories,
        route.currentOrdinal,
        new Date(route.createdAt),
        new Date(),
      );

      if (deadlineStatus === "escalation") {
        // Mark current signatory as overdue
        const updatedSignatories = signatories.map((s) => {
          if (s.ordinal === route.currentOrdinal && s.status === "pending") {
            return { ...s, status: "overdue" as const };
          }
          return s;
        });

        await tx
          .update(esignRoutes)
          .set({
            signatories: updatedSignatories,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
            version: route.version + 1,
          } as any)
          .where(
            and(
              eq(esignRoutes.id, p.id),
              eq(esignRoutes.tenantId, msg.tenantId),
              eq(esignRoutes.version, route.version),
            ),
          );

        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.esignEscalated, eventType: EVENTS.esignEscalated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: msg.tenantId, contractId: route.contractId, currentOrdinal: route.currentOrdinal, ownerId: route.ownerId },
        });
        await audit(tx, msg, "escalate", p.id);
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "esign_route", p.id));
  });
}
