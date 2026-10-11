import { pino } from "pino";
import { z } from "zod";
import { NonRetryableError, type Queue, type CommandOutcome, type CommandEnvelope } from "@civitasone/queue";
import {
  markProcessed,
  recordCommandResult,
  outcomeToResultInput,
} from "@civitasone/outbox";
import { withTenantConsumer, runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { writeAudit } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "smarttransfer.movement.consumer" });

/**
 * The command payload is produced by our own publisher, but the queue is a trust
 * boundary: a malformed payload is a permanent business rejection (NonRetryable
 * -> 'rejected' command result), never a retried 'failed'. The payload tenantId
 * must equal the envelope's, so a command can never write into another tenant.
 */
const createCyclePayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(200),
  movementTypeId: z.string().uuid(),
  calendar: z.object({ opensAt: z.string(), freezesAt: z.string(), closesAt: z.string() }),
  jurisdictionUnitId: z.string().uuid().nullable(),
});
type CreateCyclePayload = z.infer<typeof createCyclePayload>;

/**
 * Record a terminal command outcome in a SEPARATE tenant-scoped transaction
 * (D-20). The success path is also recorded inside the handler's own
 * transaction (below) so a poll immediately after the write sees 'succeeded'
 * atomically; this onOutcome hook is what captures a 'rejected'/'failed'
 * outcome, whose handler transaction rolled back and therefore recorded
 * nothing. recordCommandResult's guarded upsert never downgrades a 'succeeded'
 * row, so the two paths compose safely (I1).
 */
async function recordOutcome(outcome: CommandOutcome): Promise<void> {
  await runWithTenant(outcome.tenantId, () =>
    db.transaction((tx) => recordCommandResult(tx, outcomeToResultInput(outcome))),
  );
}

export function registerMovementConsumers(queue: Queue): void {
  // smarttransfer.cycle.create (command) → consumer:
  //   markProcessed (idempotent) + guarded insert + smarttransfer.cycle.created
  //   event + audit.event.record + command result — ALL in one transaction
  //   (house rule 1, D-20). withTenantConsumer sets app.tenant_id for every
  //   db.transaction() in the handler so FORCE RLS fences the write.
  queue.subscribe(
    COMMANDS.createCycle,
    withTenantConsumer(async (msg: CommandEnvelope<CreateCyclePayload>) => {
      const parsed = createCyclePayload.safeParse(msg.payload);
      if (!parsed.success || parsed.data.tenantId !== msg.tenantId) {
        throw new NonRetryableError("invalid smarttransfer.cycle.create payload");
      }
      const p: CreateCyclePayload = parsed.data;
      const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };

      await db.transaction(async (tx) => {
        // Idempotent redelivery: a message already processed is a no-op write,
        // but the success result is (re-)recorded so a retried poll still sees
        // 'succeeded'.
        if (!(await markProcessed(tx, msg.messageId))) {
          await recordCommandResult(tx, {
            messageId: msg.messageId,
            tenantId: msg.tenantId,
            topic: COMMANDS.createCycle,
            status: "succeeded",
            resourceType: "cycle",
            resourceId: p.id,
          });
          return;
        }

        await repo.insertCycle(tx, {
          id: p.id,
          tenantId: msg.tenantId,
          jurisdictionUnitId: p.jurisdictionUnitId ?? null,
          status: "draft",
          name: p.name,
          movementTypeId: p.movementTypeId,
          calendar: p.calendar,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        // NOTE: the frozen `smarttransfer.cycle.created` contract (#1976) names
        // audit-service + notification-service as consumers, but neither
        // subscribes to it yet — emitting it now would be an orphan event
        // (produced into the void), which the cross-service-events contract
        // ratchet blocks and D-101 forbids baselining without an owner
        // decision. The fact of the create is carried by the
        // `audit.event.record` below (consumed by audit-service today); the
        // domain event is wired in a later milestone when its consumers land.
        // Same precedent as ST-M01-03 (orphan event removed to hold the ratchet).

        await writeAudit(tx, ctx, {
          action: "cycle.create",
          resourceType: "cycle",
          resourceId: p.id,
          details: { name: p.name, movementTypeId: p.movementTypeId },
        });

        await recordCommandResult(tx, {
          messageId: msg.messageId,
          tenantId: msg.tenantId,
          topic: COMMANDS.createCycle,
          status: "succeeded",
          resourceType: "cycle",
          resourceId: p.id,
        });
      });

      await cache.invalidate(cache.makeKey(msg.tenantId, "cycle", p.id));
      log.info({ cycleId: p.id }, "smarttransfer cycle created");
    }),
    { onOutcome: recordOutcome },
  );
}
