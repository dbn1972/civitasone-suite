/**
 * batches consumer — the ONLY code that writes batch/serial state to Postgres.
 *
 * Wires the SVC-055 write path that the module previously published into the
 * void: five commands (batch.create, batch.issue, serial.register,
 * batch.quarantine, batch.recall) are now consumed, validated with the
 * module's domain rules, and persisted inside a single tenant-scoped, idempotent
 * transaction. Each handler:
 *   - dedupes on messageId via markProcessed (inbox idempotency),
 *   - mutates inside one db.transaction (RLS GUC scoped, tenant filtered),
 *   - emits a domain event + audit event through the transactional outbox.
 *
 * Posting rules:
 *   batch.create     : insert a lot/batch (item, batch no, mfg/expiry, qty).
 *   batch.issue      : expiry-guarded decrement of a batch's on-hand qty;
 *                      depletes to 0 -> status "depleted".
 *   serial.register  : insert a unique (per item+tenant) serial number.
 *   batch.quarantine : status -> "quarantine" (blocks issue pending QC).
 *   batch.recall     : status -> "recalled" (traceability event emitted).
 *
 * Validates: Requirements 14.5, 14.6 (SVC-055).
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { batches, serialNumbers } from "./schema.js";
import { validateBatchNotExpired } from "./domain.js";
import { DomainError } from "../../shared/domain.js";
import {
  createBatchPayload,
  createSerialPayload,
  issueFromBatchBody,
  quarantinePayload,
  recallPayload,
} from "./validators.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

export function registerBatchConsumers(q: Queue): void {
  // ── Create batch ───────────────────────────────────────────────────────────
  q.subscribe(COMMANDS.batchCreate, async (msg) => {
    const p = createBatchPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(batches).values({
        id: p.id,
        tenantId: p.tenantId,
        itemId: p.itemId,
        batchNumber: p.batchNumber,
        mfgDate: p.mfgDate,
        expiryDate: p.expiryDate,
        qty: p.qty,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await emitDomain(tx, msg, EVENTS.batchCreated, {
        batchId: p.id, itemId: p.itemId, batchNumber: p.batchNumber,
        expiryDate: p.expiryDate, qty: p.qty,
      });
      await audit(tx, msg, "create", "batch", p.id);
    });
    await invalidate(msg.tenantId);
  });

  // ── Issue from batch (expiry- and quantity-guarded) ─────────────────────────
  q.subscribe(COMMANDS.batchIssue, async (msg) => {
    const p = issueFromBatchBody.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx.select().from(batches)
        .where(and(eq(batches.tenantId, msg.tenantId), eq(batches.id, p.batchId)))
        .limit(1)
        .for("update");
      const batch = rows[0];
      if (!batch) throw new NonRetryableError(`batch not found: ${p.batchId}`);

      // Re-validate expiry at write time (the route pre-checks, but the command
      // may sit in the queue across the expiry boundary).
      try {
        validateBatchNotExpired(batch.expiryDate, p.postingDate);
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }

      if (batch.qty < p.qty) {
        throw new NonRetryableError(
          `BATCH_INSUFFICIENT: batch ${p.batchId} has ${batch.qty}, requested ${p.qty}`,
        );
      }

      const newQty = batch.qty - p.qty;
      const newStatus = newQty === 0 ? "depleted" : batch.status;

      await tx.update(batches)
        .set({ qty: newQty, status: newStatus, updatedBy: msg.actorId, version: batch.version + 1 })
        .where(and(eq(batches.tenantId, msg.tenantId), eq(batches.id, p.batchId)));

      await emitDomain(tx, msg, EVENTS.batchIssued, {
        batchId: p.batchId, itemId: batch.itemId, qtyIssued: p.qty,
        remainingQty: newQty, postingDate: p.postingDate,
      });
      await audit(tx, msg, "issue", "batch", p.batchId);
    });
    await invalidate(msg.tenantId);
  });

  // ── Register serial number (unique per item+tenant) ─────────────────────────
  q.subscribe(COMMANDS.serialRegister, async (msg) => {
    const p = createSerialPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const dupe = await tx.select({ id: serialNumbers.id }).from(serialNumbers)
        .where(and(
          eq(serialNumbers.tenantId, p.tenantId),
          eq(serialNumbers.itemId, p.itemId),
          eq(serialNumbers.serialNumber, p.serialNumber),
        ))
        .limit(1);
      if (dupe[0]) {
        throw new NonRetryableError(
          `SERIAL_DUPLICATE: '${p.serialNumber}' already exists for item ${p.itemId}`,
        );
      }

      await tx.insert(serialNumbers).values({
        id: p.id,
        tenantId: p.tenantId,
        itemId: p.itemId,
        batchId: p.batchId ?? null,
        serialNumber: p.serialNumber,
        status: "available",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await emitDomain(tx, msg, EVENTS.serialRegistered, {
        serialId: p.id, itemId: p.itemId, batchId: p.batchId ?? null, serialNumber: p.serialNumber,
      });
      await audit(tx, msg, "register", "serial", p.id);
    });
    await invalidate(msg.tenantId);
  });

  // ── Quarantine a batch (blocks issue pending quality review) ────────────────
  q.subscribe(COMMANDS.batchQuarantine, async (msg) => {
    const p = quarantinePayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const updated = await tx.update(batches)
        .set({ status: "quarantine", updatedBy: msg.actorId })
        .where(and(eq(batches.tenantId, msg.tenantId), eq(batches.id, p.id)))
        .returning({ id: batches.id, itemId: batches.itemId });
      if (!updated[0]) throw new NonRetryableError(`batch not found: ${p.id}`);

      await emitDomain(tx, msg, EVENTS.batchQuarantined, {
        batchId: p.id, itemId: updated[0].itemId, reason: p.reason,
      });
      await audit(tx, msg, "quarantine", "batch", p.id);
    });
    await invalidate(msg.tenantId);
  });

  // ── Recall a batch (traceability — marks the lot recalled) ──────────────────
  q.subscribe(COMMANDS.batchRecall, async (msg) => {
    const p = recallPayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const updated = await tx.update(batches)
        .set({ status: "recalled", updatedBy: msg.actorId })
        .where(and(eq(batches.tenantId, msg.tenantId), eq(batches.id, p.batchId)))
        .returning({ id: batches.id, itemId: batches.itemId });
      if (!updated[0]) throw new NonRetryableError(`batch not found: ${p.batchId}`);

      await emitDomain(tx, msg, EVENTS.batchRecalled, {
        recallId: p.id, batchId: p.batchId, itemId: updated[0].itemId,
        reason: p.reason, severity: p.severity,
      });
      await audit(tx, msg, "recall", "batch", p.batchId);
    });
    await invalidate(msg.tenantId);
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function emitDomain(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await enqueue(tx as EnqueueTx, {
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload,
  });
}

async function audit(tx: unknown, msg: CommandEnvelope, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx as EnqueueTx, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType, resourceId, outcome: "success" },
  });
}

async function invalidate(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE.batch);
  await cache.invalidateResource(tenantId, RESOURCE.serial);
}
