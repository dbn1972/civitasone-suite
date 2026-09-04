import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generatePermitNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "roadcut.permits.consumer" });

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
      workStartDate: string;
      workEndDate: string;
      conditions?: Record<string, unknown>;
    };
    const verificationCode = generateVerificationCode();
    let permitNumber = "";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // BUG FIX: permitNumber previously came from Date.now() % 999999
      // (periodic, not random -- two commands processed in the same
      // millisecond collide deterministically against permit_number's
      // UNIQUE constraint). nextval() on a real Postgres SEQUENCE, called
      // inside this same transaction, makes every value distinct by
      // construction. See migrations/0003_number_sequences.sql and
      // repo.nextPermitNumber.
      permitNumber = generatePermitNumber("ULB", await repo.nextPermitNumber(tx));
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitNumber,
        applicationId: p.applicationId,
        status: "issued",
        issuedAt: new Date(),
        workStartDate: p.workStartDate,
        workEndDate: p.workEndDate,
        conditions: p.conditions ?? null,
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
        payload: {
          permitId: p.id,
          permitNumber,
          applicationId: p.applicationId,
          workStartDate: p.workStartDate,
          workEndDate: p.workEndDate,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.issue",
        resourceType: "roadcut_permit",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitNumber }, "roadcut permit issued");
  });

  queue.subscribe(COMMANDS.extendPermit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; extendedUntil: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      applied = await repo.extendPermit(tx, p.id, msg.tenantId, p.extendedUntil, msg.actorId);
      if (!applied) return;
      await enqueue(tx, {
        topic: EVENTS.permitExtended,
        eventType: EVENTS.permitExtended,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id, extendedUntil: p.extendedUntil },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.extend",
        resourceType: "roadcut_permit",
        resourceId: p.id,
      });
    });
    // BUG FIX: the GET-by-id read-through cache (permits/routes.ts) was
    // never invalidated after a status-changing write, so a citizen/officer
    // would keep seeing pre-write state for up to the cache's TTL after
    // every extend/complete/cancel — same bug class fire-service's
    // hardening pass found and fixed (PR #1011, matching building-service's
    // consumer.ts).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });

  queue.subscribe(COMMANDS.completePermit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      applied = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", msg.actorId);
      if (!applied) return;
      await enqueue(tx, {
        topic: EVENTS.permitCompleted,
        eventType: EVENTS.permitCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.complete",
        resourceType: "roadcut_permit",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      applied = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId);
      if (!applied) return;
      await enqueue(tx, {
        topic: EVENTS.permitCancelled,
        eventType: EVENTS.permitCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.cancel",
        resourceType: "roadcut_permit",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "permit", p.id));
  });
}
