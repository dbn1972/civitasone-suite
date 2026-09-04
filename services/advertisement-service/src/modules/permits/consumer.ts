import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generatePermitNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "advertisement.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as {
      id: string;
      applicationId: string;
      validFrom: string;
      validUntil: string;
      location: Record<string, unknown>;
      advertisementType: string;
    };
    const now = new Date();
    let permitNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // BUG FIX (collision-prone number generation): see
      // applications/repo.ts's nextApplicationNumberSeq for the full
      // rationale — same fix, same shape, for permit_number.
      const seq = await repo.nextPermitNumberSeq(tx);
      permitNumber = generatePermitNumber("ULB", seq);
      const verificationCode = generateVerificationCode();
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        permitNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: p.validUntil,
        location: p.location as never,
        advertisementType: p.advertisementType,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitIssued,
        eventType: EVENTS.permitIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id, permitNumber, applicationId: p.applicationId, verificationCode },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.issue", resourceType: "adv_permit", resourceId: p.id });
    });
    log.info({ id: p.id, permitNumber }, "advertisement permit issued");
  });

  queue.subscribe(COMMANDS.renewPermit, async (msg) => {
    const p = msg.payload as { id: string; permitId: string; renewalType: string; newValidUntil: string; feeMinor: string };
    const permit = await repo.findById(p.permitId, msg.tenantId);
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Previously this handler unconditionally inserted an "approved"
      // renewal record carrying the new expiry date but NEVER wrote that
      // date back onto the permit's own `validUntil` column — GET
      // /v1/advertisement/permits/:id and the public /verify endpoint kept
      // showing the OLD validUntil (and would eventually show the permit as
      // expired to an inspector) even after a genuine renewal. Extend the
      // permit first; its boolean return also now guards against creating a
      // renewal record for a permit that no longer exists / wrong tenant
      // (previously silently used `permit?.validUntil ?? null` and proceeded
      // regardless).
      const ok = await repo.updateValidUntil(tx, p.permitId, msg.tenantId, p.newValidUntil, msg.actorId);
      if (!ok) return;
      applied = true;
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        renewalType: p.renewalType,
        status: "approved",
        // BUG FIX (money field): p.feeMinor is now validated + normalized to
        // a canonical base-10 digit string by zMoneyMinorStringNonNeg at the
        // route (permits/routes.ts renewBody) before the command is ever
        // published, so BigInt() here can no longer throw on malformed input
        // inside the write transaction (previously a bare z.string() let any
        // non-numeric string reach this BigInt() call post-202).
        feeMinor: BigInt(p.feeMinor),
        currency: "INR",
        previousValidUntil: permit?.validUntil ?? null,
        newValidUntil: p.newValidUntil,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitRenewed,
        eventType: EVENTS.permitRenewed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.id, permitId: p.permitId, newValidUntil: p.newValidUntil },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.renew", resourceType: "adv_permit", resourceId: p.permitId });
    });
    // GET /v1/advertisement/permits/:id (permits/routes.ts) reads through a
    // cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.permitId));
  });

  queue.subscribe(COMMANDS.suspendPermit, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "suspended", msg.actorId, {
        suspendedAt: new Date(),
        suspensionReason: p.reason,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.permitSuspended, eventType: EVENTS.permitSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.suspend", resourceType: "adv_permit", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId, {
        cancelledAt: new Date(),
        cancellationReason: p.reason,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.permitCancelled, eventType: EVENTS.permitCancelled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.cancel", resourceType: "adv_permit", resourceId: p.id });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });
}
