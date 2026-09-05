import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, calculateDepositMinor, generateApplicationNumber, fromStatusesFor } from "./domain.js";

const log = pino({ name: "event.applications.consumer" });

// Defense-in-depth mirroring building-service's Wave 3 pattern: this
// consumer trusts its queue payload rather than re-deriving feeMinor from
// HTTP, so a sanity ceiling is re-asserted here directly on the amount
// crossing into finance-service via emitMunicipalFeeChallan — a malformed or
// replayed command must not reach another service's ledger carrying an
// unbounded amount. calculateFeeMinor's real-world max (commercial base +
// attendance scaling + sound permission) sits far below this.
const MAX_FEE_MINOR = 10_000_000_00n; // Rs 1,00,00,000 (1 crore) in paise

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      organiserName: string;
      organiserOrg?: string;
      organiserPhone: string;
      eventType: string;
      venueName: string;
      venueAddress: Record<string, unknown>;
      startDate: string;
      endDate: string;
      expectedAttendance: number;
      temporaryStructures?: Array<{ type: string; count: number; areaSqft?: number }>;
      soundPermission?: boolean;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({
      eventType: p.eventType,
      expectedAttendance: p.expectedAttendance,
      soundPermission: p.soundPermission ?? false,
    });
    const depositMinor = calculateDepositMinor({
      eventType: p.eventType,
      expectedAttendance: p.expectedAttendance,
      soundPermission: p.soundPermission ?? false,
    });
    // Mitigation, not a full fix — see the PR description for the collision
    // mechanism (Date.now() % 999999 vs. a globally-unique column); this pattern
    // recurs across every module audited in this pass.
    const applicationNumber = generateApplicationNumber("ULB", randomInt(1, 999999));

    // CORRECTED (independent review of this PR, cross-checked against
    // finance-service's actual GL code in services/finance-service/src/modules/treasury/consumer.ts):
    // an earlier version of this consumer combined feeMinor + depositMinor
    // into ONE finance.challan.create. That's wrong — COMMANDS.challanCreate
    // books Dr Bank / Cr receipt-head, and receipt head "0075" (the only one
    // @civitasone/events defines today) is seeded with classification =
    // 'revenue'. Folding a REFUNDABLE security deposit into that silently
    // misbooks it as municipal revenue with no liability ever recorded, and
    // no GL entry exists anywhere to reverse it when post_event/decideDeposit
    // later refunds it. finance-service already has the correct path for
    // this: COMMANDS.depositCreate (Dr Bank / Cr Deposits-liability), paired
    // with depositRefund/depositForfeit to correctly dispose of it later —
    // but using it properly requires persisting the finance-generated
    // deposit id somewhere on this service's own schema so decideDeposit can
    // reference it, which is a real schema migration, not a same-PR fix.
    // roadcut-service's own Wave 3 PR hit this identical shape (fee +
    // refundable deposit) and made the same call: challan the fee only,
    // exclude the deposit, flag proper finance.deposit.create wiring as
    // follow-up (see its shared/cross-events.ts header) — matched here for
    // consistency. The organiser still owes both amounts and is told so via
    // the notification below; only the FINANCE-SIDE event is fee-only now.
    if (feeMinor > MAX_FEE_MINOR) {
      log.error({ id: p.id, feeMinor: feeMinor.toString() }, "computed application fee exceeds sanity ceiling — refusing to create application or raise a challan");
      throw new Error(`event application fee ${feeMinor.toString()} exceeds MAX_FEE_MINOR ceiling`);
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        organiserName: p.organiserName,
        organiserOrg: p.organiserOrg ?? null,
        organiserPhone: p.organiserPhone,
        eventType: p.eventType,
        venueName: p.venueName,
        venueAddress: p.venueAddress as never,
        startDate: p.startDate,
        endDate: p.endDate,
        expectedAttendance: p.expectedAttendance,
        temporaryStructures: p.temporaryStructures as never ?? null,
        soundPermission: p.soundPermission ?? false,
        documents: p.documents ?? [],
        feeMinor,
        depositMinor,
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.applicationCreated,
        eventType: EVENTS.applicationCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          applicationId: p.id,
          applicationNumber,
          feeMinor: String(feeMinor),
          depositMinor: String(depositMinor),
          currency: "INR",
        },
      });
      // Cross-service wiring (municipal-sec5 event contract, Wave 3): assess
      // the application fee (fee ONLY -- see the correction above for why
      // depositMinor is deliberately excluded here) via finance.challan.create,
      // and tell the organiser what's due (both amounts), in the same
      // transaction as the application row and its own domain event —
      // all-or-nothing with the write that created the obligation in the
      // first place.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: p.id,
        depositor: msg.actorId,
        amountMinor: feeMinor,
        currency: "INR",
      });
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.feeDue,
        recipient: msg.actorId,
        recipientId: p.id,
        variables: {
          applicationId: p.id,
          applicationNumber,
          feeMinor: String(feeMinor),
          depositMinor: String(depositMinor),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.create",
        resourceType: "event_application",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, applicationNumber }, "event application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", fromStatusesFor("submitted"), msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.applicationSubmitted,
        eventType: EVENTS.applicationSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id },
      });
      // Cross-service wiring: applicant-facing status notification.
      // `updated` already carries the full row via updateStatus's own
      // UPDATE ... RETURNING inside this SAME transaction — no separate
      // lookup needed, so there's no scopedRead-vs-open-transaction deadlock
      // risk here at all (see building-service PR #1035 for that class of
      // bug, fixed via a findByIdInTx variant where a fresh read actually
      // was needed).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: updated.createdBy,
        recipientId: p.id,
        variables: { applicationId: p.id, applicationNumber: updated.applicationNumber },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.submit",
        resourceType: "event_application",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`event:${msg.tenantId}:application:${p.id}`, updated);
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", fromStatusesFor("withdrawn"), msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.applicationWithdrawn,
        eventType: EVENTS.applicationWithdrawn,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "application.withdraw",
        resourceType: "event_application",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`event:${msg.tenantId}:application:${p.id}`, updated);
  });
}
