import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import { computeExpiryDate } from "./domain.js";

const log = pino({ name: "loyalty.accruals.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerAccrualConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.accruePoints, async (msg) => {
    const p = msg.payload as {
      id: string;
      enrolmentId: string;
      points: number;
      source: string;
      sourceRef: string | null;
      txType: string;
      enrolmentVersion: number;
    };
    const pointsBigInt = BigInt(p.points);
    const now = new Date();
    const expiresAt = computeExpiryDate(now, null);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        enrolmentId: p.enrolmentId,
        points: pointsBigInt,
        source: p.source,
        sourceRef: p.sourceRef,
        txType: p.txType,
        expiresAt,
        accrualDate: now,
        createdBy: msg.actorId,
      });
      await enrolmentRepo.adjustBalance(
        tx,
        p.enrolmentId,
        msg.tenantId,
        pointsBigInt,
        pointsBigInt,
        p.enrolmentVersion,
      );
      await enqueue(tx, {
        topic: EVENTS.pointsAccrued,
        eventType: EVENTS.pointsAccrued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { accrualId: p.id, enrolmentId: p.enrolmentId, points: p.points },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "points.accrue",
        resourceType: "loyalty_accrual",
        resourceId: p.id,
        details: { enrolmentId: p.enrolmentId, points: p.points },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "enrolment", p.enrolmentId));
    log.info({ id: p.id }, "points accrued");
  });
}
