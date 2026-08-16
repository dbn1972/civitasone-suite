/**
 * srn consumer — handles Store Receipt Note create and sign commands.
 *
 * Every handler:
 *   1. dedupes via markProcessed (idempotency),
 *   2. mutates inside a single transaction with a transactional-outbox event,
 *   3. invalidates the read cache after commit.
 *
 * GFR Rule 149: an SRN can only be created against a GRN that has passed
 * inspection ('accepted') — verified via a cross-service call to
 * procurement-service since the two services are separate databases.
 *
 * Requirements: 1.1
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { storeReceiptNotes } from "./schema.js";
import { canCreateSrn, canSignSrn, DomainError } from "./domain.js";
import { fetchGrn, ProcurementUnavailableError } from "./grn-client.js";

type EnqueueTx = Parameters<typeof enqueue>[0];

export function registerSrnConsumers(q: Queue): void {
  q.subscribe(COMMANDS.srnCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; grnId: string; storeOfficerId: string; remarks?: string;
    };

    // Cross-service gate BEFORE the transaction: procurement-service owns the
    // GRN; a network failure here must not silently create an SRN against an
    // unverified GRN, nor should it be swallowed as "GRN not found".
    let grn;
    try {
      grn = await fetchGrn(msg.tenantId, p.grnId);
    } catch (err) {
      if (err instanceof ProcurementUnavailableError) throw err; // retryable — bus will redeliver
      throw err;
    }
    if (!grn) throw new NonRetryableError(`GRN_NOT_FOUND: grn ${p.grnId} does not exist`);
    try {
      if (!canCreateSrn({ status: grn.status })) {
        throw new DomainError("GRN_NOT_ACCEPTED", `GRN ${p.grnId} must be accepted before an SRN can be raised (status: ${grn.status})`);
      }
    } catch (err) {
      if (err instanceof DomainError) throw new NonRetryableError(err.message);
      throw err;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // One SRN per GRN per tenant — the unique index also protects concurrent
      // creates, but this pre-check gives a clear NonRetryableError instead of
      // a raw 23505 for the common sequential case.
      const existing = await tx.select().from(storeReceiptNotes)
        .where(and(eq(storeReceiptNotes.tenantId, msg.tenantId), eq(storeReceiptNotes.grnId, p.grnId)))
        .limit(1);
      if (existing[0]) throw new NonRetryableError(`SRN_ALREADY_EXISTS: grn ${p.grnId} already has an SRN`);

      try {
        await tx.insert(storeReceiptNotes).values({
          id: p.id,
          tenantId: msg.tenantId,
          grnId: p.grnId,
          storeOfficerId: p.storeOfficerId,
          remarks: p.remarks ?? null,
          status: "draft",
        });
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new NonRetryableError(`SRN_ALREADY_EXISTS: grn ${p.grnId} already has an SRN`);
        }
        throw err;
      }

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.srnCreated, eventType: EVENTS.srnCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, grnId: p.grnId, status: "draft" },
      });
      await audit(tx as EnqueueTx, msg, "create", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.srn);
  });

  q.subscribe(COMMANDS.srnSign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; receivedAt?: string; remarks?: string };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx.select().from(storeReceiptNotes)
        .where(and(eq(storeReceiptNotes.tenantId, msg.tenantId), eq(storeReceiptNotes.id, p.id)))
        .limit(1);
      const srn = rows[0];
      if (!srn) throw new NonRetryableError(`SRN_NOT_FOUND: srn ${p.id} does not exist`);
      try {
        if (!canSignSrn({ status: srn.status as "draft" | "signed" })) {
          throw new DomainError("SRN_ALREADY_SIGNED", `SRN ${p.id} is already signed`);
        }
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }

      const [updated] = await tx.update(storeReceiptNotes)
        .set({
          status: "signed",
          receivedAt: p.receivedAt ? new Date(p.receivedAt) : new Date(),
          remarks: p.remarks ?? srn.remarks,
        })
        .where(and(eq(storeReceiptNotes.id, p.id), eq(storeReceiptNotes.tenantId, msg.tenantId)))
        .returning();
      if (!updated) return;

      await enqueue(tx as EnqueueTx, {
        topic: EVENTS.srnSigned, eventType: EVENTS.srnSigned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, grnId: updated.grnId, status: "signed" },
      });
      await audit(tx as EnqueueTx, msg, "sign", p.id);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.srn);
  });
}

async function audit(tx: EnqueueTx, msg: CommandEnvelope, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "inventory", action, resourceType: "store_receipt_note", resourceId, outcome: "success" },
  });
}
