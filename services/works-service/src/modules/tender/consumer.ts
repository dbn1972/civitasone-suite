import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { preTenders, tenders, quotations, awards } from "./schema.js";
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

export function registerTenderConsumers(q: Queue): void {
  q.subscribe(COMMANDS.preTenderCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(preTenders).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        referenceNumber: (p.referenceNumber as string) ?? null,
        tenderType: (p.tenderType as string) ?? null,
        tenderCategory: (p.tenderCategory as string) ?? null,
        bidValidity: (p.bidValidity as number) ?? null,
        fees: p.fees ? BigInt(p.fees as string | number) : null,
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.preTenderCreated,
        eventType: EVENTS.preTenderCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "pre_tender", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.awardCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(awards).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        contractorName: p.contractorName as string,
        agreementNumber: (p.agreementNumber as string) ?? null,
        workOrderNumber: (p.workOrderNumber as string) ?? null,
        workPeriodDays: (p.workPeriodDays as number) ?? null,
        billMode: (p.billMode as string) ?? null,
        acceptedAmountMinor: BigInt(p.acceptedAmountMinor as string | number),
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.awardCreated,
        eventType: EVENTS.awardCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "award", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX: add a contractor quotation to a tender.
  q.subscribe(COMMANDS.quotationAdd, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(quotations).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        tenderId: p.tenderId as string,
        contractorName: p.contractorName as string,
        method: p.method as string,
        quotedAmountMinor: p.quotedAmountMinor !== undefined ? BigInt(p.quotedAmountMinor as string | number) : null,
        quotedPercentage: (p.quotedPercentage as string) ?? null,
        aboveOrBelowOrAtPar: (p.aboveOrBelowOrAtPar as string) ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.quotationAdded,
        eventType: EVENTS.quotationAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, tenderId: p.tenderId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "tender", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-067): DAO-finalize award — level 1 of two-level finalization.
  // Guarded update (status must still be 'draft') enforces the transition even
  // on redelivery / concurrent DO-finalize.
  q.subscribe(COMMANDS.awardDaoFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };
      await tx.update(awards)
        .set({ status: "dao_finalized", daoFinalizedBy: msg.actorId, daoFinalizedAt: new Date() })
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, id), eq(awards.status, "draft")));

      await enqueue(tx, {
        topic: EVENTS.awardDaoFinalized,
        eventType: EVENTS.awardDaoFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "award_dao", resourceId: id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-067): DO-finalize award — level 2, requires dao_finalized.
  q.subscribe(COMMANDS.awardDoFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };
      await tx.update(awards)
        .set({ status: "do_finalized", doFinalizedBy: msg.actorId, doFinalizedAt: new Date() })
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, id), eq(awards.status, "dao_finalized")));

      await enqueue(tx, {
        topic: EVENTS.awardDoFinalized,
        eventType: EVENTS.awardDoFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, {
        topic: EVENTS.awardFinalized,
        eventType: EVENTS.awardFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "award", resourceId: id, outcome: "success" } });
    });
  });
}
