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

const log = pino({ name: "loyalty.redemptions.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRedemptionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.redeemPoints, async (msg) => {
    const p = msg.payload as {
      id: string;
      enrolmentId: string;
      memberId: string;
      points: number;
      rewardType: string;
      status: string;
      enrolmentVersion: number;
    };
    const pointsBigInt = BigInt(p.points);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        memberId: p.memberId,
        enrolmentId: p.enrolmentId,
        points: pointsBigInt,
        rewardType: p.rewardType,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enrolmentRepo.adjustBalance(
        tx,
        p.enrolmentId,
        msg.tenantId,
        -pointsBigInt,
        BigInt(0),
        p.enrolmentVersion,
      );
      await enqueue(tx, {
        topic: EVENTS.pointsRedeemed,
        eventType: EVENTS.pointsRedeemed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { redemptionId: p.id, enrolmentId: p.enrolmentId, points: p.points },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "points.redeem",
        resourceType: "loyalty_redemption",
        resourceId: p.id,
        details: { enrolmentId: p.enrolmentId, points: p.points },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "enrolment", p.enrolmentId));
    log.info({ id: p.id }, "points redeemed");
  });

  queue.subscribe(COMMANDS.voidRedemption, async (msg) => {
    const p = msg.payload as {
      id: string;
      reason: string;
      version: number;
      enrolmentId: string | null;
      points: string;
    };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.voidRedemption(tx, p.id, msg.tenantId, p.reason, msg.actorId, p.version);
      if (!ok) return;
      applied = true;
      if (p.enrolmentId) {
        const enrolment = await enrolmentRepo.findById(p.enrolmentId, msg.tenantId);
        if (enrolment) {
          await enrolmentRepo.adjustBalance(
            tx,
            p.enrolmentId,
            msg.tenantId,
            BigInt(p.points),
            BigInt(0),
            enrolment.version,
          );
        }
      }
      await enqueue(tx, {
        topic: EVENTS.redemptionVoided,
        eventType: EVENTS.redemptionVoided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { redemptionId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "redemption.void",
        resourceType: "loyalty_redemption",
        resourceId: p.id,
        details: { reason: p.reason },
      });
    });
    if (applied && p.enrolmentId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "enrolment", p.enrolmentId));
    }
    if (applied) log.info({ id: p.id }, "redemption voided");
  });
}
