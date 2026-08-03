import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "workflow-delegations-consumer" });
const AUDIT = "audit.event.record";

export function registerDelegationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createDelegation, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; delegatorId: string; delegateId: string;
      fromDate: string; toDate: string | null; reason: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.create({ ...p, id: p.id }, tx);
        await enqueue(tx, { topic: EVENTS.delegationCreated, eventType: EVENTS.delegationCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
        await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId, payload: { service: "workflow", action: "create",
            resourceType: "delegation", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createDelegation failed"); throw err; }
  });

  queue.subscribe(COMMANDS.revokeDelegation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.revoke(p.id, p.tenantId, tx);
        await enqueue(tx, { topic: EVENTS.delegationRevoked, eventType: EVENTS.delegationRevoked,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
        await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId, payload: { service: "workflow", action: "revoke",
            resourceType: "delegation", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "revokeDelegation failed"); throw err; }
  });
}
