import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
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
    const now = new Date();
    const permitNumber = generatePermitNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();
    const validUntil = calculateValidUntil(now, p.validityMonths);

    // The transaction reports back whether it actually inserted the permit, so
    // the "permit issued" log below can't fire on a silently-skipped duplicate
    // (markProcessed no-op or a caught 23505) — a log claiming success when
    // nothing was written is exactly the fake-success class this pass targets,
    // just shifted from data into logs.
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
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
