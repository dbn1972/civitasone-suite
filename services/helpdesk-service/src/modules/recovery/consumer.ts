import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { recoveryPolicies, recoveryActions } from "./schema.js";
import type { RecoveryActionStatus } from "./schema.js";

const log = pino({ name: "helpdesk.recovery.consumer" });
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType, resourceId, outcome: "success" },
  });
}

export function registerRecoveryConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.recoveryPolicyCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; severityThreshold: string;
      productCode?: string | null; maxGoodwillMinor: string; currency: string;
      requiresApproval: boolean; approverRole: string; active: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(recoveryPolicies).values({
        id: p.id,
        tenantId: p.tenantId,
        severityThreshold: p.severityThreshold,
        productCode: p.productCode ?? null,
        maxGoodwillMinor: BigInt(p.maxGoodwillMinor),
        currency: p.currency,
        requiresApproval: p.requiresApproval,
        approverRole: p.approverRole,
        active: p.active,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "recovery_policy_create", "recovery_policy", p.id);
    });
    log.info({ id: p.id }, "recovery policy created");
  });

  queue.subscribe(COMMANDS.recoveryActionCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ticketId: string; policyId: string;
      actionType: string; amountMinor: string | null; currency: string;
      reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Verify policy exists and belongs to tenant
      const [policy] = await tx.select().from(recoveryPolicies)
        .where(and(eq(recoveryPolicies.id, p.policyId), eq(recoveryPolicies.tenantId, p.tenantId)))
        .limit(1);
      if (!policy) {
        log.warn({ policyId: p.policyId }, "recovery action skipped — policy not found");
        return;
      }
      await tx.insert(recoveryActions).values({
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        policyId: p.policyId,
        actionType: p.actionType as "goodwill_credit" | "replacement" | "priority_service" | "apology_comm",
        amountMinor: p.amountMinor ? BigInt(p.amountMinor) : null,
        currency: p.currency,
        status: "pending_approval",
        reason: p.reason ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "recovery_action_create", "recovery_action", p.id);
    });
    log.info({ id: p.id, ticketId: p.ticketId }, "recovery action created");
  });

  queue.subscribe(COMMANDS.recoveryActionApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx.select().from(recoveryActions)
        .where(and(eq(recoveryActions.id, p.id), eq(recoveryActions.tenantId, p.tenantId)))
        .limit(1);
      if (!existing || existing.status !== "pending_approval") return;
      await tx.update(recoveryActions).set({
        status: "approved" as RecoveryActionStatus,
        approvedBy: msg.actorId,
        approvedAt: new Date(),
        reason: p.reason ?? existing.reason,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: existing.version + 1,
      }).where(and(eq(recoveryActions.id, p.id), eq(recoveryActions.tenantId, p.tenantId)));
      await audit(tx, msg, "recovery_action_approve", "recovery_action", p.id);
    });
    log.info({ id: p.id }, "recovery action approved");
  });

  queue.subscribe(COMMANDS.recoveryActionReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx.select().from(recoveryActions)
        .where(and(eq(recoveryActions.id, p.id), eq(recoveryActions.tenantId, p.tenantId)))
        .limit(1);
      if (!existing || existing.status !== "pending_approval") return;
      await tx.update(recoveryActions).set({
        status: "rejected" as RecoveryActionStatus,
        reason: p.reason ?? existing.reason,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: existing.version + 1,
      }).where(and(eq(recoveryActions.id, p.id), eq(recoveryActions.tenantId, p.tenantId)));
      await audit(tx, msg, "recovery_action_reject", "recovery_action", p.id);
    });
    log.info({ id: p.id }, "recovery action rejected");
  });
}
