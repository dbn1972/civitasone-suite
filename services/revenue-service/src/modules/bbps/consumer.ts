import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { bbpsTransactions } from "./schema.js";
import { receipts } from "../collection/schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { buildFetchBillResponse, validateBbpsPayment, DomainError } from "./domain.js";
import { getDcbOutstandingTx } from "./repo.js";

export function registerBbpsConsumers(queue: Queue): void {
  // ── bbpsFetchBill ─────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bbpsFetchBill, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assesseeIdentifier } = msg.payload as { assesseeIdentifier: string };

      // Get DCB outstanding for the assessee
      const dcb = await getDcbOutstandingTx(tx, msg.tenantId, assesseeIdentifier);
      if (!dcb) return;

      // Build fetch-bill response (throws DomainError if no outstanding)
      const billDate = new Date().toISOString().slice(0, 10);
      const _response = buildFetchBillResponse(dcb, billDate);

      // Insert bbps_transaction with status: pending
      await tx.insert(bbpsTransactions).values({
        tenantId: msg.tenantId,
        bbpsTxnId: `FETCH-${msg.messageId.slice(0, 8)}`,
        assesseeId: dcb.assesseeId,
        amountMinor: dcb.totalOutstandingMinor,
        channel: "bbps",
        status: "pending",
        messageId: msg.messageId,
        requestType: "fetch",
      });

      // Audit
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "fetch_bill", resourceType: "bbps_transaction", outcome: "success" },
      });
    });
  });

  // ── bbpsPayBill ───────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.bbpsPayBill, async (msg) => {
    const { assesseeIdentifier, amountMinor, bbpsTxnId, channel } = msg.payload as {
      assesseeIdentifier: string;
      amountMinor: string;
      bbpsTxnId: string;
      channel: string;
    };

    const paymentAmount = BigInt(amountMinor);
    let assesseeId: string | undefined;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

      // Get DCB outstanding
      const dcb = await getDcbOutstandingTx(tx, msg.tenantId, assesseeIdentifier);
      if (!dcb) {
        // GAP-REVENUE-BBPS-02: an unknown assessee identifier is a real failure
        // the officer must see, not a silent no-op. Surface it as a DomainError
        // so the outer catch records a `failed` status row for this messageId.
        throw new DomainError("ASSESSEE_NOT_FOUND", "No assessee matches this identifier");
      }

      assesseeId = dcb.assesseeId;

      // SEC-001: the amount actually posted below is never a bare pass-through
      // of the caller-declared amountMinor. It is bound against dcb.totalOutstandingMinor
      // — the assessee's real outstanding balance, re-read fresh inside this
      // transaction — the same "never trust a client-carried total, always
      // check it against the authoritative record" principle the finance
      // GL core applies to its own totals. A claim that is <= 0 or exceeds
      // the real outstanding balance throws here and the whole transaction
      // (which has not written anything yet) rolls back — no receipt, no DCB
      // entry, no bbps_transaction row, no event.
      //
      // This bound is defense in depth on top of, not a replacement for, the
      // requireRole gate in routes.ts: this consumer only ever runs for a
      // command that already passed that check.
      validateBbpsPayment(paymentAmount, dcb.totalOutstandingMinor);

      // SEC-001 replay protection: atomically claim (tenant_id, bbps_txn_id)
      // via the unique constraint added in
      // migrations/0006_bbps_replay_protection.sql, race-free the same way
      // @civitasone/outbox's markProcessed claims a messageId (ON CONFLICT
      // DO NOTHING + RETURNING — no SELECT-then-INSERT gap two concurrent
      // deliveries of the "same" replayed payload could both pass). An empty
      // `claimed` means this exact bbpsTxnId was already processed for this
      // tenant — a replay of a previously-accepted (payload,) request — and
      // this consumer returns without writing a second receipt, DCB entry,
      // or receiptCaptured event. receiptId is attached below once the
      // receipt exists; the row is claimed first (receiptId null) precisely
      // so a duplicate is rejected BEFORE any receipt/DCB row is written.
      const claimed = await tx.insert(bbpsTransactions).values({
        tenantId: msg.tenantId,
        bbpsTxnId,
        assesseeId: dcb.assesseeId,
        amountMinor: paymentAmount,
        channel,
        status: "success",
        messageId: msg.messageId,
        requestType: "pay",
      }).onConflictDoNothing({
        target: [bbpsTransactions.tenantId, bbpsTransactions.bbpsTxnId],
      }).returning({ id: bbpsTransactions.id });

      const bbpsTransactionId = claimed[0]?.id;
      if (!bbpsTransactionId) {
        await enqueue(tx, {
          topic: "audit.event.record",
          eventType: "audit.event.record",
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: SERVICE,
            action: "pay_bill",
            resourceType: "bbps_transaction",
            outcome: "rejected_duplicate",
            reason: "bbpsTxnId already processed for this tenant (replay)",
          },
        });
        return;
      }

      // Insert receipt
      const receiptRows = await tx.insert(receipts).values({
        tenantId: msg.tenantId,
        assesseeId: dcb.assesseeId,
        demandId: dcb.assesseeId, // BBPS pays across all demands
        amountMinor: paymentAmount,
        channel,
        reference: bbpsTxnId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      }).returning({ id: receipts.id });

      const receiptId = receiptRows[0]?.id ?? null;

      // Insert DCB entry (collection)
      await tx.insert(dcbEntries).values({
        tenantId: msg.tenantId,
        assesseeId: dcb.assesseeId,
        demandId: dcb.assesseeId,
        entryType: "collection",
        amountMinor: paymentAmount,
        balanceMinor: dcb.totalOutstandingMinor - paymentAmount,
        referenceId: receiptId,
        referenceType: "receipt",
        narration: `BBPS payment via ${channel} (txn: ${bbpsTxnId})`,
        createdBy: msg.actorId,
      });

      // Attach the receipt to the bbps_transaction row claimed above.
      if (receiptId) {
        await tx.update(bbpsTransactions)
          .set({ receiptId })
          .where(and(eq(bbpsTransactions.id, bbpsTransactionId), eq(bbpsTransactions.tenantId, msg.tenantId)));
      }

      // Enqueue receipt captured event (receiptId required by finance GL consumer)
      await enqueue(tx, {
        topic: EVENTS.receiptCaptured,
        eventType: EVENTS.receiptCaptured,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          receiptId: receiptId ?? bbpsTxnId,
          assesseeId: dcb.assesseeId,
          amountMinor,
          channel,
          bbpsTxnId,
        },
      });

      // Audit
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "pay_bill", resourceType: "bbps_transaction", outcome: "success" },
      });
    });
    } catch (err) {
      // GAP-REVENUE-BBPS-02: a validation/lookup failure must leave a visible
      // `failed` status row (keyed by this messageId) so the officer polling
      // GET /v1/revenue/bbps/requests/:messageId sees the real outcome and
      // reason — never a silent roll-back. Recorded in a SEPARATE transaction
      // (the business transaction rolled back). onConflictDoNothing guards the
      // bbpsTxnId unique index: if a success row already claimed it, we do not
      // overwrite it. A DomainError carries a safe, human-ish reason; anything
      // else is recorded generically (never leak internals/PII).
      const reason = err instanceof DomainError ? err.message : "BBPS payment could not be processed";
      try {
        await db.transaction(async (tx) => {
          await tx
            .insert(bbpsTransactions)
            .values({
              tenantId: msg.tenantId,
              bbpsTxnId,
              assesseeId: assesseeId ?? null,
              amountMinor: paymentAmount,
              channel,
              status: "failed",
              messageId: msg.messageId,
              requestType: "pay",
              failureReason: reason,
            })
            .onConflictDoNothing({ target: [bbpsTransactions.tenantId, bbpsTransactions.bbpsTxnId] });
          await enqueue(tx, {
            topic: "audit.event.record",
            eventType: "audit.event.record",
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: { service: SERVICE, action: "pay_bill", resourceType: "bbps_transaction", outcome: "failed", reason },
          });
        });
      } catch {
        // Never let the status-recording path mask the original failure path;
        // the command simply remains unprocessed and is retried by the queue.
      }
    }

    // Cache invalidation
    if (assesseeId) {
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assesseeId}`);
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:receipts:${assesseeId}`);
    }
  });
}
