import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "swm.bulk_generators.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerBulkGeneratorConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.bulkGeneratorRegister, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: msg.tenantId, registrationNumber: p.registrationNumber,
        generatorName: p.generatorName, generatorType: p.generatorType,
        address: p.address, estimatedWasteKgPerDay: p.estimatedWasteKgPerDay,
        category: p.category, status: "registered", feeMinor: p.feeMinor,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.bulkGeneratorRegistered, eventType: EVENTS.bulkGeneratorRegistered,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { generatorId: p.id, registrationNumber: p.registrationNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "bulk_generator.register", resourceType: "swm_bulk_generator", resourceId: p.id });
    });
    log.info({ id: p.id }, "bulk generator registered");
  });

  queue.subscribe(COMMANDS.bulkGeneratorUpdate, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { ...p.patch, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await writeAudit(tx, ctxOf(msg), { action: "bulk_generator.update", resourceType: "swm_bulk_generator", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "bulk generator updated");
  });

  queue.subscribe(COMMANDS.bulkGeneratorSuspend, async (msg) => {
    const p = msg.payload as any;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "suspended", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.bulkGeneratorSuspended, eventType: EVENTS.bulkGeneratorSuspended,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { generatorId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "bulk_generator.suspend", resourceType: "swm_bulk_generator", resourceId: p.id });
    });
    if (applied) log.info({ id: p.id }, "bulk generator suspended");
  });
}
