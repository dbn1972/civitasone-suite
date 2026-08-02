import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import { evaluateTier, type TierDef } from "./domain.js";

const log = pino({ name: "loyalty.tiers.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerTierConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.evaluateTier, async (msg) => {
    const p = msg.payload as { id: string; enrolmentId: string; programId: string };
    const enrolment = await enrolmentRepo.findById(p.enrolmentId, msg.tenantId);
    if (!enrolment) {
      await db.transaction(async (tx) => {
        await markProcessed(tx, msg.messageId);
      });
      return;
    }

    const tierDefs = await repo.listDefinitions(msg.tenantId, p.programId);
    const currentAssignment = await repo.findCurrentAssignment(msg.tenantId, p.enrolmentId);
    const defs: TierDef[] = tierDefs.map((d) => ({
      id: d.id,
      name: d.name,
      level: d.level,
      minPointsThreshold: d.minPointsThreshold,
    }));
    const result = evaluateTier(enrolment.lifetimePoints, defs, currentAssignment?.tierDefinitionId ?? null);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(result.changed && result.newTierId)) return;

      const assignmentId = randomUUID();
      await repo.insertAssignment(tx, {
        id: assignmentId,
        tenantId: msg.tenantId,
        enrolmentId: p.enrolmentId,
        tierDefinitionId: result.newTierId,
        assignedAt: new Date(),
      });
      await enrolmentRepo.update(
        tx,
        p.enrolmentId,
        msg.tenantId,
        { tier: result.newTierName, updatedBy: msg.actorId },
        enrolment.version,
      );
      await enqueue(tx, {
        topic: EVENTS.tierChanged,
        eventType: EVENTS.tierChanged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          enrolmentId: p.enrolmentId,
          previousTierId: currentAssignment?.tierDefinitionId ?? null,
          newTierId: result.newTierId,
          direction: result.direction,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "tier.evaluate",
        resourceType: "loyalty_enrolment",
        resourceId: p.enrolmentId,
        details: { newTierId: result.newTierId, direction: result.direction },
      });
    });

    if (result.changed) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "enrolment", p.enrolmentId));
    }
    log.info({ enrolmentId: p.enrolmentId, changed: result.changed }, "tier evaluated");
  });
}
