import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "loyalty.enrolments.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

function invalidateEnrolment(tenantId: string, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(tenantId, "enrolment", id));
}

export function registerEnrolmentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.enrolMember, async (msg) => {
    const p = msg.payload as {
      id: string;
      programId: string;
      profileId: string;
      tier: string;
      status: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        programId: p.programId,
        profileId: p.profileId,
        status: p.status,
        tier: p.tier,
        pointsBalance: BigInt(0),
        lifetimePoints: BigInt(0),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.memberEnrolled,
        eventType: EVENTS.memberEnrolled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { enrolmentId: p.id, programId: p.programId, profileId: p.profileId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "enrolment.create", resourceType: "loyalty_enrolment", resourceId: p.id });
    });
    log.info({ id: p.id }, "member enrolled");
  });

  queue.subscribe(COMMANDS.updateEnrolmentStatus, async (msg) => {
    const p = msg.payload as { id: string; status: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: p.status, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.enrolmentStatusChanged,
        eventType: EVENTS.enrolmentStatusChanged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { enrolmentId: p.id, status: p.status },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "enrolment.update_status",
        resourceType: "loyalty_enrolment",
        resourceId: p.id,
        details: { status: p.status },
      });
    });
    if (applied) await invalidateEnrolment(msg.tenantId, p.id);
  });
}
