import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, generateApplicationNumber } from "./domain.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification } from "../../shared/cross-events.js";
import { MUNICIPAL_EVENT_TYPES } from "@civitasone/events";

/**
 * BUG (found live while writing this module's smoke tests): GET
 * /v1/trade/applications/:id serves `cache.getOrLoad("trade:<tenant>:application:<id>", ...)`
 * (routes.ts), but nothing ever called cache.invalidate*() after a write — every
 * consumer below mutated the row and left the OLD response cached for the full
 * CACHE_TTL (default 60s). Reproduced: create → GET (caches "draft") → submit →
 * scrutiny-initiate → GET again → still "draft" for up to a minute. Fixed by
 * invalidating the "application" cache resource for this tenant right after each
 * write commits (see @civitasone/cache's invalidateResourceAfterCommit — same
 * pattern already used by services/admin-service's F3 consumers).
 *
 * Wave 3 (cross-service wiring, see shared/cross-events.ts): submitApplication
 * is where the licence fee (calculateFeeMinor, computed and stored on the row
 * at create time) actually becomes payable — a citizen submitting a trade
 * application is committing to pay before scrutiny proceeds. That's the one
 * point in this module's lifecycle where a real financial obligation begins,
 * so it's the point a finance.challan.create is raised (feeMinor stays a
 * bigint end-to-end into emitMunicipalFeeChallan — never coerced through a
 * JS number — the same precision discipline PR #1012 already applied to this
 * module's fee inputs). recordFeePayment (below) exists purely to mark that
 * challan paid once the citizen settles it; nothing before this wiring ever
 * actually produced the challan the citizen was meant to pay.
 */

const log = pino({ name: "trade.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      businessName: string;
      tradeCategory: string;
      subCategory?: string;
      ownerName: string;
      premisesAddress: Record<string, unknown>;
      areaInSqft?: number;
      employeeCount?: number;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const feeMinor = calculateFeeMinor({
      tradeCategory: p.tradeCategory,
      areaInSqft: p.areaInSqft,
      employeeCount: p.employeeCount,
    });
    // See services/trade-service/src/modules/licences/consumer.ts for why
    // Date.now() % N is a deterministic-collision hazard on a UNIQUE column
    // (application_number), not a source of randomness — same fix applied
    // here for applicationNumber.
    const applicationNumber = generateApplicationNumber("ULB", randomInt(1, 999999));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        businessName: p.businessName,
        tradeCategory: p.tradeCategory,
        subCategory: p.subCategory ?? null,
        ownerName: p.ownerName,
        premisesAddress: p.premisesAddress as never,
        areaInSqft: p.areaInSqft ?? null,
        employeeCount: p.employeeCount ?? null,
        documents: p.documents ?? [],
        feeMinor,
        feeCurrency: "INR",
        feePaid: false,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.applicationCreated,
        eventType: EVENTS.applicationCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, applicationNumber, businessName: p.businessName, feeMinor: String(feeMinor), feeCurrency: "INR" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "trade_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "trade application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    // Read before the tx (same pattern as lifecycle/consumer.ts's
    // decideRenewal): the fee challan and the citizen notification both need
    // the row's fee/owner details, which the write below never returns.
    const application = await repo.findById(p.id, msg.tenantId);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "submitted", msg.actorId);
      if (!ok) return;
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "application");
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      if (application && application.feeMinor && application.feeMinor > 0n) {
        await emitMunicipalFeeChallan(tx, ctxOf(msg), {
          sourceRef: p.id,
          depositor: application.businessName,
          amountMinor: application.feeMinor,
        });
      }
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: application?.businessName ?? "Applicant",
        ...(application?.createdBy ? { recipientId: application.createdBy } : {}),
        variables: { applicationId: p.id, applicationNumber: application?.applicationNumber ?? "", serviceName: "trade" },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "trade_application", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "application");
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "trade_application", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.recordFeePayment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; transactionId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateFeePayment(tx, p.id, msg.tenantId, p.transactionId, msg.actorId);
      if (!ok) return;
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "application");
      await enqueue(tx, { topic: EVENTS.feePaymentRecorded, eventType: EVENTS.feePaymentRecorded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.id, transactionId: p.transactionId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.fee_payment", resourceType: "trade_application", resourceId: p.id });
    });
  });
}
