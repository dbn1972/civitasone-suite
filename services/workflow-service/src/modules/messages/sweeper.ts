import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as historyRepo from "../history/repo.js";

const log = pino({ name: "workflow-message-sweeper" });
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a1";
const AUDIT_TOPIC = "audit.event.record";

/**
 * Find message subscriptions that have timed out (timeout_at <= now) and mark
 * them expired. For each expired subscription, publish a completeTask(reject)
 * command so the waiting task fails (the message was not received in time).
 * Returns the number of subscriptions expired this sweep.
 */
export async function sweepExpiredMessages(now = new Date(), batch = 100): Promise<number> {
  const expired = await repo.findExpiredSubscriptions(now, batch);
  let count = 0;

  for (const sub of expired) {
    try {
      await db.transaction(async (tx) => {
        // Mark subscription as expired
        await repo.expireSubscription(tx, sub.id);

        const correlationId = randomUUID();

        // Publish completeTask(reject) — timeout means the message wasn't received
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: COMMANDS.completeTask,
          eventType: COMMANDS.completeTask,
          tenantId: sub.tenantId,
          actorId: SYSTEM_ACTOR_ID,
          correlationId,
          payload: {
            id: sub.taskId,
            tenantId: sub.tenantId,
            instanceId: sub.instanceId,
            name: `Message timeout: ${sub.messageName}`,
            status: "pending",
            roleRef: null,
            nodeKey: sub.nodeKey,
            decision: "reject",
            sodOverride: true,
          },
        });

        // Record in transition_history
        await historyRepo.record(tx, {
          tenantId: sub.tenantId,
          instanceId: sub.instanceId,
          taskId: sub.taskId,
          fromNode: sub.nodeKey,
          toNode: sub.nodeKey,
          action: "message_timeout",
          decision: "reject",
          actorId: SYSTEM_ACTOR_ID,
          detail: {
            messageName: sub.messageName,
            correlationKey: sub.correlationKey,
            timeoutAt: sub.timeoutAt?.toISOString() ?? null,
          },
        });

        // Audit event
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: sub.tenantId,
          actorId: SYSTEM_ACTOR_ID,
          correlationId,
          payload: {
            service: "workflow",
            action: "message_timeout",
            resourceType: "message_subscription",
            resourceId: sub.id,
            outcome: "success",
          },
        });

        count++;
      });
    } catch (err) {
      log.error({ subscriptionId: sub.id, err }, "failed to expire message subscription");
    }
  }

  if (count > 0) log.info({ count }, "message sweeper expired timed-out subscriptions");
  return count;
}

/** Run the message timeout sweeper on an interval. Never throws out of the loop. */
export function startMessageSweeper(intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepExpiredMessages().catch((err) => log.error({ err }, "message sweep cycle failed"));
  }, intervalMs);
}
