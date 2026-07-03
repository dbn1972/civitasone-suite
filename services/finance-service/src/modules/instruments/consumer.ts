import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const log = pino({ name: "finance.instruments.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerInstrumentsConsumers(queue: Queue): void {
  queue.subscribe("finance.instrument.issue", async (msg) => {
    const p = msg.payload as {
      tenantId: string; instrumentType: string; instrumentNo: string;
      bankName: string; payee: string; amountMinor: number; currency?: string;
      issueDate?: string; bankAccountId?: string; paymentId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const issueDate = p.issueDate ?? new Date().toISOString().slice(0, 10);
      await repo.insertInstrument({
        tenantId: p.tenantId,
        instrumentType: p.instrumentType,
        instrumentNo: p.instrumentNo,
        bankName: p.bankName,
        payee: p.payee,
        amountMinor: BigInt(p.amountMinor),
        currency: p.currency ?? "INR",
        issueDate,
        status: "issued",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        ...(p.bankAccountId ? { bankAccountId: p.bankAccountId } : {}),
        ...(p.paymentId ? { paymentId: p.paymentId } : {}),
      });
      await enqueue(tx, {
        topic: "finance.instrument.issued", eventType: "finance.instrument.issued",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { instrumentNo: p.instrumentNo, instrumentType: p.instrumentType, amountMinor: p.amountMinor },
      });
      await audit(tx, msg, "issue", "instrument", p.instrumentNo);
    });
    await cache.invalidate(`finance:${msg.tenantId}:instruments:*`);
    log.info({ id: msg.messageId }, "Processed instrument.issue");
  });

  queue.subscribe("finance.instrument.transition", async (msg) => {
    const p = msg.payload as {
      tenantId: string; id: string; action: "present" | "clear" | "bounce" | "cancel";
      reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const fromStates: { [k: string]: string[] } = {
        present: ["issued"],
        clear: ["issued", "presented"],
        bounce: ["issued", "presented"],
        cancel: ["issued"],
      };
      const toStatus: { [k: string]: string } = {
        present: "presented",
        clear: "cleared",
        bounce: "bounced",
        cancel: "cancelled",
      };
      const tsField: { [k: string]: "presentedAt" | "clearedAt" | "bouncedAt" | "cancelledAt" } = {
        present: "presentedAt",
        clear: "clearedAt",
        bounce: "bouncedAt",
        cancel: "cancelledAt",
      };
      const from = fromStates[p.action];
      const to = toStatus[p.action];
      const ts = tsField[p.action];
      if (!from || !to || !ts) throw new Error(`UNKNOWN_ACTION: ${p.action}`);
      const extras = p.action === "bounce" && p.reason ? { bounceReason: p.reason } : {};
      const updated = await repo.transition(
        p.tenantId, p.id, from, to,
        extras, ts, msg.actorId,
      );
      if (!updated) throw new Error(`ILLEGAL_TRANSITION: instrument ${p.id} cannot ${p.action}`);
      await enqueue(tx, {
        topic: `finance.instrument.${to}`, eventType: `finance.instrument.${to}`,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, status: to },
      });
      await audit(tx, msg, p.action, "instrument", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:instruments:*`);
    log.info({ id: msg.messageId, action: p.action }, "Processed instrument.transition");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
