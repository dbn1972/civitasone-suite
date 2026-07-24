import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { preTenders, tenders, quotations, awards } from "./schema.js";

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
    });
  });
}
