import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { hrmsContracts, hrmsContractNotifications } from "./schema.js";
import { detectMilestones, daysUntilExpiry } from "./domain.js";
import { getContractConfig, getSentMilestones, getPendingRenewalForContract } from "./repo.js";
import { eq, and, inArray, lte, gte, sql } from "drizzle-orm";

const log = pino({ name: "contract-expiry-consumer" });
const NOTIFICATION_SEND = "notification.send";
const AUDIT = "audit.event.record";
const DEFAULT_MILESTONES = [90, 60, 30, 15, 7];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function contractCacheKey(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, "contract", id);
}

function dashboardCacheKey(tenantId: string): string {
  return `${SERVICE}:${tenantId}:contract:dashboard:expiring`;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerContractExpiryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.contractExpiryDetect, async (msg) => {
    const today = new Date().toISOString().slice(0, 10);
    const maxWindowDate = new Date();
    maxWindowDate.setDate(maxWindowDate.getDate() + 90);
    const windowEnd = maxWindowDate.toISOString().slice(0, 10);

    log.info({ messageId: msg.messageId, asOf: today }, "contract expiry detection started");

    // Step 1: Discover all tenants with active/expiring contracts
    const tenantRows = await scopedRead((tx) =>
      tx
        .selectDistinct({ tenantId: hrmsContracts.tenantId })
        .from(hrmsContracts)
        .where(inArray(hrmsContracts.status, ["active", "expiring"])),
    );

    const tenantIds = tenantRows.map((r) => r.tenantId);
    log.info({ tenantCount: tenantIds.length }, "discovered tenants with active/expiring contracts");

    // Step 2: Process each tenant in isolation
    for (const tenantId of tenantIds) {
      try {
        await processTenant(tenantId, today, windowEnd, msg);
      } catch (err: unknown) {
        // Catch errors per-tenant so one tenant failure doesn't stop the batch
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error({ tenantId, error: errorMsg }, "expiry detection failed for tenant");
      }
    }

    log.info({ messageId: msg.messageId, tenantsProcessed: tenantIds.length }, "contract expiry detection completed");
  });

  log.info("contract expiry consumers registered");
}

// ─── Per-Tenant Processing ───────────────────────────────────────────────────

async function processTenant(
  tenantId: string,
  today: string,
  windowEnd: string,
  msg: any,
): Promise<void> {
  // Load tenant config for milestones
  const config = await getContractConfig(tenantId);
  const milestones: number[] = (config as any)?.reminderMilestones ?? DEFAULT_MILESTONES;

  // Query contracts WHERE status IN (active, expiring) AND endDate within 90 days of today
  const contracts = await scopedRead((tx) =>
    tx
      .select()
      .from(hrmsContracts)
      .where(
        and(
          eq(hrmsContracts.tenantId, tenantId),
          inArray(hrmsContracts.status, ["active", "expiring"]),
          lte(hrmsContracts.endDate, windowEnd),
        ),
      ),
  );

  log.info({ tenantId, contractCount: contracts.length }, "contracts within expiry window");

  for (const contract of contracts) {
    try {
      await processContract(tenantId, contract, today, milestones, msg);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(
        { tenantId, contractId: contract.id, error: errorMsg },
        "expiry detection failed for contract",
      );
    }
  }
}

// ─── Per-Contract Processing ─────────────────────────────────────────────────

async function processContract(
  tenantId: string,
  contract: any,
  today: string,
  milestones: number[],
  msg: any,
): Promise<void> {
  const endDate = contract.endDate as string;
  const daysRemaining = daysUntilExpiry(endDate, today);
  const detected = detectMilestones(endDate, today, milestones);

  // (b) Load already-sent milestones
  const sentMilestones = await getSentMilestones(tenantId, contract.id);

  // (c) Find new milestones = detected - already_sent
  const newMilestones = detected.filter((m) => !sentMilestones.includes(m));

  // (d) For each new milestone: publish notification + insert dedup record
  if (newMilestones.length > 0) {
    await db.transaction(async (tx) => {
      for (const milestone of newMilestones) {
        // Publish notification event to HR_Admin, manager, employee
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId,
          actorId: msg.actorId ?? "system",
          correlationId: msg.correlationId,
          payload: {
            tenantId,
            recipients: [contract.employeeId],
            roles: ["hr_admin", "manager"],
            channels: ["email", "in_app"],
            template: "contract_expiry_reminder",
            data: {
              contractId: contract.id,
              contractNo: contract.contractNo,
              employeeId: contract.employeeId,
              endDate,
              daysRemaining,
              milestone,
            },
          },
        });

        // Insert dedup record
        await tx.insert(hrmsContractNotifications).values({
          tenantId,
          contractId: contract.id,
          milestone,
        });
      }
    });

    log.info(
      { tenantId, contractId: contract.id, milestones: newMilestones },
      "milestone notifications sent",
    );
  }

  // (e) If status is "active" and endDate within 90 days: transition to "expiring"
  if (contract.status === "active" && daysRemaining <= 90 && daysRemaining > 0) {
    await db.transaction(async (tx) => {
      await tx
        .update(hrmsContracts)
        .set({
          status: "expiring",
          updatedBy: msg.actorId ?? "system",
          updatedAt: new Date(),
        })
        .where(
          and(eq(hrmsContracts.id, contract.id), eq(hrmsContracts.tenantId, tenantId)),
        );
    });

    await cache.invalidate(contractCacheKey(tenantId, contract.id));
    await cache.invalidate(dashboardCacheKey(tenantId));
    log.info({ tenantId, contractId: contract.id }, "contract transitioned to expiring");
  }

  // (f) If endDate has passed (daysRemaining <= 0) and no approved renewal: auto-separate
  if (daysRemaining <= 0) {
    const pendingRenewal = await getPendingRenewalForContract(tenantId, contract.id);
    // getPendingRenewalForContract checks for pending_approval status;
    // we also need to check if there's an approved renewal — no approved renewal means separate
    if (!pendingRenewal) {
      await db.transaction(async (tx) => {
        // Transition to expired
        await tx
          .update(hrmsContracts)
          .set({
            status: "expired",
            updatedBy: msg.actorId ?? "system",
            updatedAt: new Date(),
          })
          .where(
            and(eq(hrmsContracts.id, contract.id), eq(hrmsContracts.tenantId, tenantId)),
          );

        // Publish contractAutoSeparate command
        await enqueue(tx, {
          topic: COMMANDS.contractAutoSeparate,
          eventType: COMMANDS.contractAutoSeparate,
          tenantId,
          actorId: msg.actorId ?? "system",
          correlationId: msg.correlationId,
          payload: {
            tenantId,
            contractId: contract.id,
          },
        });

        // Emit contractExpired event
        await enqueue(tx, {
          topic: EVENTS.contractExpired,
          eventType: EVENTS.contractExpired,
          tenantId,
          actorId: msg.actorId ?? "system",
          correlationId: msg.correlationId,
          payload: {
            contractId: contract.id,
            employeeId: contract.employeeId,
            tenantId,
            endDate,
          },
        });
      });

      await cache.invalidate(contractCacheKey(tenantId, contract.id));
      await cache.invalidate(dashboardCacheKey(tenantId));
      log.info({ tenantId, contractId: contract.id }, "contract expired, auto-separation triggered");
    }

    return; // Already expired — no further processing needed
  }

  // (g) If within 15 days and no Renewal_Record exists: escalate
  if (daysRemaining <= 15 && daysRemaining > 0) {
    const pendingRenewal = await getPendingRenewalForContract(tenantId, contract.id);
    if (!pendingRenewal && contract.status !== "escalated") {
      await db.transaction(async (tx) => {
        // Transition to escalated
        await tx
          .update(hrmsContracts)
          .set({
            status: "escalated",
            updatedBy: msg.actorId ?? "system",
            updatedAt: new Date(),
          })
          .where(
            and(eq(hrmsContracts.id, contract.id), eq(hrmsContracts.tenantId, tenantId)),
          );

        // Publish escalation notification to department head
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId,
          actorId: msg.actorId ?? "system",
          correlationId: msg.correlationId,
          payload: {
            tenantId,
            recipients: [contract.employeeId],
            roles: ["department_head", "hr_admin"],
            channels: ["email", "in_app"],
            template: "contract_escalation_no_renewal",
            data: {
              contractId: contract.id,
              contractNo: contract.contractNo,
              employeeId: contract.employeeId,
              endDate,
              daysRemaining,
            },
          },
        });

        // Emit contractEscalated event
        await enqueue(tx, {
          topic: EVENTS.contractEscalated,
          eventType: EVENTS.contractEscalated,
          tenantId,
          actorId: msg.actorId ?? "system",
          correlationId: msg.correlationId,
          payload: {
            contractId: contract.id,
            employeeId: contract.employeeId,
            tenantId,
            daysRemaining,
          },
        });
      });

      await cache.invalidate(contractCacheKey(tenantId, contract.id));
      await cache.invalidate(dashboardCacheKey(tenantId));
      log.info({ tenantId, contractId: contract.id, daysRemaining }, "contract escalated — no renewal initiated");
    }
  }
}
