/**
 * Custodian consumer (WRITE PATH) — the only code that writes custodian rows.
 *
 * Handles inventory.custodian.create:
 *   1. dedupes via markProcessed (idempotency),
 *   2. inserts the custodian assignment inside a single transaction,
 *   3. enqueues an audit event (transactional outbox) in that same transaction,
 *   4. invalidates the read cache after commit.
 *
 * GAP2-INVENTORY-CUSTODIANS-01.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { custodians } from "../items/schema.js";
import { createCustodianPayload } from "./validators.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

export function registerCustodianConsumers(q: Queue): void {
  q.subscribe(COMMANDS.custodianCreate, async (msg) => {
    const p = createCustodianPayload.parse(msg.payload);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await (tx as unknown as typeof db).insert(custodians).values({
        id:            p.id,
        tenantId:      p.tenantId,
        storeId:       p.storeId,
        employeeRef:   p.employeeRef,
        designation:   p.designation ?? null,
        effectiveFrom: p.effectiveFrom,
        effectiveTo:   p.effectiveTo ?? null,
        status:        "active",
        createdBy:     msg.actorId,
        updatedBy:     msg.actorId,
      });

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.custodianCreated, eventType: EVENTS.custodianCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, storeId: p.storeId, status: "active" },
      });
      await audit(tx as EnqueueTx, msg, "create", p.id);
    });

    await cache.invalidateResource(msg.tenantId, RESOURCE.custodian);
  });
}

async function audit(tx: EnqueueTx, msg: CommandEnvelope, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType: "custodian", resourceId, outcome: "success" },
  });
}
