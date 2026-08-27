import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { randomInt } from "node:crypto";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";
import { generateAllotmentNumber, fromStatusesFor } from "./domain.js";

const log = pino({ name: "market.allotments.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerAllotmentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.applyAllotment, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      propertyId: string;
      allotteeName: string;
      allotteePhone?: string;
      allotteeAadhaar?: string;
      allotmentType: string;
      monthlyRentMinor?: string;
      securityDepositMinor?: string;
    };
    // Mitigation, not a full fix — Date.now() % 999999 repeats every ~16.7min
    // against a table-wide (non-tenant-scoped) .unique() column; crypto.randomInt
    // reduces collision probability without a schema change. Real fix (a
    // per-tenant DB sequence) is a follow-up — this exact pattern recurs
    // fleet-wide across every service audited in this pass.
    const allotmentNumber = generateAllotmentNumber("ULB", randomInt(1, 999999));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAllotment(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        allotmentNumber,
        propertyId: p.propertyId,
        allotteeName: p.allotteeName,
        allotteePhone: p.allotteePhone ?? null,
        allotteeAadhaar: p.allotteeAadhaar ?? null,
        allotmentType: p.allotmentType,
        allotmentDate: null,
        agreementStartDate: null,
        agreementEndDate: null,
        monthlyRentMinor: p.monthlyRentMinor ? BigInt(p.monthlyRentMinor) : null,
        securityDepositMinor: p.securityDepositMinor ? BigInt(p.securityDepositMinor) : null,
        currency: "INR",
        status: "applied",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.allotmentApplied,
        eventType: EVENTS.allotmentApplied,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { allotmentId: p.id, allotmentNumber, propertyId: p.propertyId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "allotment.apply",
        resourceType: "market_allotment",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, allotmentNumber }, "market allotment applied");
  });

  queue.subscribe(COMMANDS.selectAllottee, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const today = new Date().toISOString().slice(0, 10);
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "selected", fromStatusesFor("selected"), msg.actorId, {
        allotmentDate: today,
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.allotteeSelected,
        eventType: EVENTS.allotteeSelected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { allotmentId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "allotment.select",
        resourceType: "market_allotment",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`market:${msg.tenantId}:allotment:${p.id}`, updated);
  });

  queue.subscribe(COMMANDS.signAgreement, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; agreementStartDate: string; agreementEndDate: string };
    let updated: Awaited<ReturnType<typeof repo.updateStatus>> = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      updated = await repo.updateStatus(tx, p.id, msg.tenantId, "agreement_signed", fromStatusesFor("agreement_signed"), msg.actorId, {
        agreementStartDate: p.agreementStartDate,
        agreementEndDate: p.agreementEndDate,
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.agreementSigned,
        eventType: EVENTS.agreementSigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { allotmentId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "allotment.sign_agreement",
        resourceType: "market_allotment",
        resourceId: p.id,
      });
    });
    if (updated) await cache.put(`market:${msg.tenantId}:allotment:${p.id}`, updated);
  });
}
