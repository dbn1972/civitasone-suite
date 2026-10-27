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
      const deducted = await enrolmentRepo.adjustBalance(
        tx,
        p.enrolmentId,
        msg.tenantId,
        -pointsBigInt,
        BigInt(0),
        p.enrolmentVersion,
      );
      // CLOS3-S5-02: a lost optimistic lock must roll back the whole tx.
      enrolmentRepo.assertBalanceAdjusted(deducted, p.enrolmentId, "redeemPoints");
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
        // TX-001: was enrolmentRepo.findById(), a bare read that opens its own
        // db.transaction() via scopedRead() -- nested inside this consumer's
        // already-open outer tx, that has no free pool connection to open on
        // under pool.max concurrent in-flight voidRedemption commands and
        // deadlocks the pool silently. Route through the outer tx instead.
        const enrolment = await enrolmentRepo.findByIdTx(tx, p.enrolmentId, msg.tenantId);
        if (enrolment) {
          const restored = await enrolmentRepo.adjustBalance(
            tx,
            p.enrolmentId,
            msg.tenantId,
            BigInt(p.points),
            BigInt(0),
            enrolment.version,
          );
          // CLOS3-S5-02: do not commit the void without the balance restore.
          enrolmentRepo.assertBalanceAdjusted(restored, p.enrolmentId, "voidRedemption");
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

  // GAP-LOYALTY-REDEMPTIONS-02: pending -> fulfilled. markProcessed + guarded
  // write (status, version, SoD) + audit in ONE txn.
  queue.subscribe(COMMANDS.fulfilRedemption, async (msg) => {
    const p = msg.payload as { id: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      applied = await repo.fulfilRedemption(tx, p.id, msg.tenantId, msg.actorId, p.version);
      if (!applied) return;
      await writeAudit(tx, ctxOf(msg), {
        action: "redemption.fulfil",
        resourceType: "loyalty_redemption",
        resourceId: p.id,
        details: {},
      });
    });
    if (applied) log.info({ id: p.id }, "redemption fulfilled");
    else log.warn({ id: p.id }, "fulfil not applied (state, version or SoD guard)");
  });

  // pending -> rejected, held points restored to the enrolment in the same txn.
  queue.subscribe(COMMANDS.rejectRedemption, async (msg) => {
    const p = msg.payload as { id: string; reason: string; version: number };
    let enrolmentId: string | null = null;
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rejected = await repo.rejectRedemption(tx, p.id, msg.tenantId, p.reason, msg.actorId, p.version);
      if (!rejected) return;
      applied = true;
      enrolmentId = rejected.enrolmentId;
      if (rejected.enrolmentId) {
        const enrolment = await enrolmentRepo.findByIdTx(tx, rejected.enrolmentId, msg.tenantId);
        if (enrolment) {
          const restored = await enrolmentRepo.adjustBalance(
            tx,
            rejected.enrolmentId,
            msg.tenantId,
            rejected.points,
            BigInt(0),
            enrolment.version,
          );
          enrolmentRepo.assertBalanceAdjusted(restored, rejected.enrolmentId, "rejectRedemption");
        }
      }
      await writeAudit(tx, ctxOf(msg), {
        action: "redemption.reject",
        resourceType: "loyalty_redemption",
        resourceId: p.id,
        details: { reason: p.reason },
      });
    });
    if (applied && enrolmentId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "enrolment", enrolmentId));
    }
    if (applied) log.info({ id: p.id }, "redemption rejected");
  });
}
