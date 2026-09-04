import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../registrations/repo.js";
import { generatePermitNumber, generateVerificationCode, calculateValidUntil, canPerformAction } from "./domain.js";

const log = pino({ name: "shop.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicationId: string;
      establishmentName: string;
      validityMonths: number;
    };
    // The route already checks the application is approved and has no existing
    // permit, but that check is a snapshot at request time — two concurrent or
    // retried issue commands for the same application could both pass it. This
    // pre-check narrows the race; the unique index on permits.application_id
    // (migration 0002) is the actual atomic backstop, caught below.
    const existingPermit = await repo.findByApplicationId(p.applicationId, msg.tenantId);
    if (existingPermit) {
      log.warn(
        { applicationId: p.applicationId, existingPermitId: existingPermit.id },
        "issuePermit: a permit already exists for this application, skipping duplicate issuance",
      );
      return;
    }
    // Looked up here (not inside the transaction) purely to resolve the
    // applicant's identity for the citizen notification below — the permit
    // row itself carries no applicant reference, only application_id.
    const application = await appRepo.findById(p.applicationId, msg.tenantId);
    const now = new Date();
    const verificationCode = generateVerificationCode();
    const validUntil = calculateValidUntil(now, p.validityMonths);
    let permitNumber = "";

    // The transaction reports back whether it actually inserted the permit, so
    // the "permit issued" log below can't fire on a silently-skipped duplicate
    // (markProcessed no-op or a caught 23505) — a log claiming success when
    // nothing was written is exactly the fake-success class this pass targets,
    // just shifted from data into logs.
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      // `Date.now() % 999999` (periodic on ~16.7 minutes) replaced with a
      // real Postgres SEQUENCE reserved inside this same transaction — see
      // repo.ts's nextPermitNumber for the full rationale.
      permitNumber = generatePermitNumber("ULB", await repo.nextPermitNumber(tx));
      try {
        await repo.insertPermit(tx, {
          id: p.id,
          tenantId: msg.tenantId,
          applicationId: p.applicationId,
          permitNumber,
          establishmentName: p.establishmentName,
          permitStatus: "active",
          issuedAt: now,
          validFrom: now,
          validUntil,
          verificationCode,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await repo.insertDirectoryEntry(tx, {
          verificationCode,
          tenantId: msg.tenantId,
          permitId: p.id,
          permitNumber,
          establishmentName: p.establishmentName,
          permitStatus: "active",
          issuedAt: now,
          validFrom: now,
          validUntil,
        });
      } catch (err) {
        const pgErr = err as { code?: string; constraint_name?: string };
        if (pgErr.code === "23505") {
          log.warn(
            { applicationId: p.applicationId, constraint: pgErr.constraint_name },
            "issuePermit: duplicate issuance blocked by a unique constraint, skipping",
          );
          return false;
        }
        throw err;
      }
      await enqueue(tx, {
        topic: EVENTS.permitIssued,
        eventType: EVENTS.permitIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          permitId: p.id,
          permitNumber,
          applicationId: p.applicationId,
          establishmentName: p.establishmentName,
          validFrom: now.toISOString(),
          validUntil: validUntil.toISOString(),
          verificationCode,
        },
      });
      // Citizen-meaningful transition: the permit is now live. Falls back to
      // the establishment/actor identity if the underlying application was
      // somehow not found (should not happen given the FK, but this must
      // never block permit issuance itself).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.permitIssued,
        recipient: application?.ownerName ?? p.establishmentName,
        recipientId: application?.applicantId ?? msg.actorId,
        variables: { permitId: p.id, permitNumber, establishmentName: p.establishmentName },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.issue",
        resourceType: "shop_permit",
        resourceId: p.id,
      });
      return true;
    });
    if (applied) log.info({ id: p.id, permitNumber }, "permit issued");
  });

  queue.subscribe(COMMANDS.suspendPermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    // Re-validate against the CURRENT persisted status — the route only checked a
    // snapshot at request time, and async command delivery is not guaranteed to be
    // ordered, so a racing/stale command must not be allowed to force an illegal
    // transition (e.g. resurrecting an already-cancelled permit).
    const current = await repo.findById(p.permitId, msg.tenantId);
    if (!current || !canPerformAction(current.permitStatus, "suspended")) {
      log.warn(
        { permitId: p.permitId, currentStatus: current?.permitStatus },
        "suspendPermit: stale or invalid transition, skipping",
      );
      return;
    }
    const application = await appRepo.findById(current.applicationId, msg.tenantId);
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      const ok = await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, ["active"], "suspended", {
        suspendedAt: new Date(),
        suspensionReason: p.reason,
      }, msg.actorId);
      if (!ok) return false;
      await repo.insertAction(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "suspension",
        reason: p.reason,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitSuspended,
        eventType: EVENTS.permitSuspended,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.permitId, reason: p.reason },
      });
      // Citizen-meaningful (adverse) transition — the holder must be told
      // their permit was suspended and why.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.ownerName ?? current.establishmentName,
        recipientId: application?.applicantId ?? msg.actorId,
        variables: { permitId: p.permitId, status: "suspended", reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.suspend",
        resourceType: "shop_permit",
        resourceId: p.permitId,
      });
      return true;
    });
    // GET /v1/shop/permits/:id (permits/routes.ts) reads through a cache that
    // only permit-mutating write paths can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.permitId));
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    const current = await repo.findById(p.permitId, msg.tenantId);
    if (!current || !canPerformAction(current.permitStatus, "cancelled")) {
      log.warn(
        { permitId: p.permitId, currentStatus: current?.permitStatus },
        "cancelPermit: stale or invalid transition, skipping",
      );
      return;
    }
    const application = await appRepo.findById(current.applicationId, msg.tenantId);
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      const ok = await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, ["active", "suspended"], "cancelled", {
        cancelledAt: new Date(),
        cancellationReason: p.reason,
      }, msg.actorId);
      if (!ok) return false;
      await repo.insertAction(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "cancellation",
        reason: p.reason,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitCancelled,
        eventType: EVENTS.permitCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.permitId, reason: p.reason },
      });
      // Citizen-meaningful (adverse) transition.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.ownerName ?? current.establishmentName,
        recipientId: application?.applicantId ?? msg.actorId,
        variables: { permitId: p.permitId, status: "cancelled", reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.cancel",
        resourceType: "shop_permit",
        resourceId: p.permitId,
      });
      return true;
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.permitId));
  });

  queue.subscribe(COMMANDS.restorePermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    const current = await repo.findById(p.permitId, msg.tenantId);
    if (!current || !canPerformAction(current.permitStatus, "active")) {
      log.warn(
        { permitId: p.permitId, currentStatus: current?.permitStatus },
        "restorePermit: stale or invalid transition, skipping",
      );
      return;
    }
    const application = await appRepo.findById(current.applicationId, msg.tenantId);
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      const ok = await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, ["suspended"], "active", {
        suspendedAt: null,
        suspensionReason: null,
      }, msg.actorId);
      if (!ok) return false;
      await repo.insertAction(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "restoration",
        reason: p.reason,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitRestored,
        eventType: EVENTS.permitRestored,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.permitId, reason: p.reason },
      });
      // Citizen-meaningful transition — the holder's permit is active again.
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.statusChanged,
        recipient: application?.ownerName ?? current.establishmentName,
        recipientId: application?.applicantId ?? msg.actorId,
        variables: { permitId: p.permitId, status: "active", reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.restore",
        resourceType: "shop_permit",
        resourceId: p.permitId,
      });
      return true;
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.permitId));
  });

  queue.subscribe(COMMANDS.issueNotice, async (msg) => {
    const p = msg.payload as {
      id: string;
      permitId: string;
      tenantId: string;
      noticeDetails: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAction(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "notice",
        noticeDetails: p.noticeDetails,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.noticeIssued,
        eventType: EVENTS.noticeIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { noticeId: p.id, permitId: p.permitId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.notice",
        resourceType: "shop_permit_action",
        resourceId: p.id,
      });
    });
  });
}
