import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { SAFE_LOG_SERIALIZERS } from "../../shared/safe-error-log.js";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, SERVICE } from "../../topics.js";
import { hrmsContractConfig } from "./schema.js";
const log = pino({ name: "hrms-f3-contracts", serializers: SAFE_LOG_SERIALIZERS });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`):
 * `contracts_routes__0` referenced undefined `insertValues` / `updateSet` locals. The
 * code-gen tool left the *builders* for those two objects behind in routes.ts (see the
 * PATCH /v1/hrms/contracts/config handler) but moved only the upsert here, so every
 * config PATCH threw a ReferenceError in this consumer after the route had already
 * answered 200 — the tenant's contract config (reminder milestones, approval chain,
 * auto-separation, scheduler time) never actually changed.
 *
 * The builders below are reproduced field-for-field from routes.ts. `updateConfigBody`
 * declares every field `.optional()` with no `.default(...)`, so the raw queued body
 * behaves identically to the Zod-parsed one: an absent key stays absent and is simply
 * not written, which is what the explicit `!== undefined` guards preserve.
 */
export function registerF3_contracts_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "contracts_routes__0",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "contracts_routes__0": {
            // Build insert/update payloads explicitly to satisfy exactOptionalPropertyTypes
            const insertValues: Record<string, unknown> = { tenantId: p.tenantId, updatedAt: new Date() };
            const updateSet: Record<string, unknown> = { updatedAt: new Date(), version: sql`${hrmsContractConfig.version} + 1` };
            if (body.reminderMilestones !== undefined) {
              insertValues.reminderMilestones = body.reminderMilestones;
              updateSet.reminderMilestones = body.reminderMilestones;
            }
            if (body.approvalChain !== undefined) {
              insertValues.approvalChain = body.approvalChain;
              updateSet.approvalChain = body.approvalChain;
            }
            if (body.autoSeparationEnabled !== undefined) {
              insertValues.autoSeparationEnabled = body.autoSeparationEnabled;
              updateSet.autoSeparationEnabled = body.autoSeparationEnabled;
            }
            if (body.schedulerTimeUtc !== undefined) {
              insertValues.schedulerTimeUtc = body.schedulerTimeUtc;
              updateSet.schedulerTimeUtc = body.schedulerTimeUtc;
            }
        if (body.lapseAction !== undefined) {
          insertValues.lapseAction = body.lapseAction;
          updateSet.lapseAction = body.lapseAction;
        }
        if (body.graceDays !== undefined) {
          insertValues.graceDays = body.graceDays;
          updateSet.graceDays = body.graceDays;
        }
        if (body.notifyRoles !== undefined) {
          insertValues.notifyRoles = body.notifyRoles;
          updateSet.notifyRoles = body.notifyRoles;
        }
        if (body.employeeProjectionEnabled !== undefined) {
          insertValues.employeeProjectionEnabled = body.employeeProjectionEnabled;
          updateSet.employeeProjectionEnabled = body.employeeProjectionEnabled;
        }
        if (body.weeklyDigestEnabled !== undefined) {
          insertValues.weeklyDigestEnabled = body.weeklyDigestEnabled;
          updateSet.weeklyDigestEnabled = body.weeklyDigestEnabled;
        }
            const updated = await tx
                    .insert(hrmsContractConfig)
                    .values(insertValues as typeof hrmsContractConfig.$inferInsert)
                    .onConflictDoUpdate({
                      target: hrmsContractConfig.tenantId,
                      set: updateSet,
                    })
                    .returning();
                  // S8 G5: the policy change is audited (who set lapse_action / routing, and to what).
                  await enqueue(tx, {
                    topic: "audit.event.record",
                    eventType: "audit.event.record",
                    tenantId: p.tenantId,
                    actorId: msg.actorId,
                    correlationId: msg.correlationId,
                    payload: {
                      service: SERVICE, action: "config_update", resourceType: "contract_config",
                      resourceId: p.tenantId, outcome: "success",
                      changed: Object.keys(body).filter((k) => body[k] !== undefined),
                      ...(body.lapseAction !== undefined ? { lapseAction: body.lapseAction } : {}),
                    },
                  });
                  // Turning the employee read-model on (or re-saving config while on) rebuilds it for this tenant.
                  if (body.employeeProjectionEnabled === true) {
                    await enqueue(tx, {
                      topic: COMMANDS.contractProjectionReconcile,
                      eventType: COMMANDS.contractProjectionReconcile,
                      tenantId: p.tenantId,
                      actorId: msg.actorId,
                      correlationId: msg.correlationId,
                      payload: { tenantId: p.tenantId },
                    });
                  }
                  return updated[0] ?? null;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
