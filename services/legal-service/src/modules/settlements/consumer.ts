import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerSettlementConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.settlementCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseId?: string; settlementNo: string;
      amountMinor: number; currency?: string;
      lokAdalat?: { lokAdalatDate: string; venue: string; outcome?: string };
    };
    const now = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSettlement(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId ?? null,
        settlementNo: p.settlementNo, amountMinor: BigInt(p.amountMinor),
        currency: p.currency ?? "INR", status: "settled", settledAt: now,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.lokAdalat) {
        await repo.insertLokAdalat(tx, {
          id: randomUUID(), tenantId: p.tenantId, settlementId: p.id,
          lokAdalatDate: p.lokAdalat.lokAdalatDate, venue: p.lokAdalat.venue,
          outcome: p.lokAdalat.outcome ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "create", "settlement", p.id);
    });
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
