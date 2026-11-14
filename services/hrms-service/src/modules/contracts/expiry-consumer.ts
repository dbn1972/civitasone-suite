import { pino } from "pino";
import { SAFE_LOG_SERIALIZERS } from "../../shared/safe-error-log.js";
import { type Queue } from "@civitasone/queue";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, SYSTEM_ACTOR_ID } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { hrmsContracts, hrmsContractNotifications } from "./schema.js";
import { detectMilestones, daysUntilExpiry } from "./domain.js";
import { getContractConfig, getSentMilestones, getPendingRenewalForContract } from "./repo.js";
import { eq, and, inArray, lte, gte } from "drizzle-orm";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsContractRenewals } from "./schema.js";
import { getContractConfigTx } from "./repo.js";
import {
  syncEmployeeContractProjection, reconcileTenantProjection, invalidateEmployeeCache, projectFromTerms, IN_FORCE,
} from "./projection.js";
import {
  resolveLapsePolicy, resolveNotifyRoles, routeRecipients, flagOnlyDue, buildDigest, isDigestDay,
  LAPSE_FLAGGED_MARK, type LapsePolicy, type NotifyRole,
} from "./policy.js";

const log = pino({ name: "contract-expiry-consumer", serializers: SAFE_LOG_SERIALIZERS });
const NOTIFICATION_SEND = "notification.send";
const DEFAULT_MILESTONES = [90, 60, 30, 15, 7];
const AUDIT = "audit.event.record";

/** S8 G5 per-tenant behaviour. The default is exactly the behaviour before G5 (auto-separate, HR + manager roles only). */
type TenantCfg = { policy: LapsePolicy; notifyRoles: NotifyRole[] };
const DEFAULT_CFG: TenantCfg = { policy: { action: "auto_separate", graceDays: 0 }, notifyRoles: [] };

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
        .where(inArray(hrmsContracts.status, ["active", "expiring", "escalated"])),
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
  // S8 G5: policy + routing are read uncached, so a lapse_action flip applies on the very next run.
  const live = await scopedRead((tx) => getContractConfigTx(tx, tenantId));
  const cfg: TenantCfg = { policy: resolveLapsePolicy(live), notifyRoles: resolveNotifyRoles(live) };

  // Query contracts WHERE status IN (active, expiring) AND endDate within 90 days of today
  const contracts = await scopedRead((tx) =>
    tx
      .select()
      .from(hrmsContracts)
      .where(
        and(
          eq(hrmsContracts.tenantId, tenantId),
          inArray(hrmsContracts.status, ["active", "expiring", "escalated"]),
          lte(hrmsContracts.endDate, windowEnd),
        ),
      ),
  );

  log.info({ tenantId, contractCount: contracts.length }, "contracts within expiry window");

  for (const contract of contracts) {
    try {
      await processContract(tenantId, contract, today, milestones, msg, cfg);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(
        { tenantId, contractId: contract.id, error: errorMsg },
        "expiry detection failed for contract",
      );
    }
  }

  await runTenantExtras(tenantId, today, live);
}

// ─── Per-Contract Processing ─────────────────────────────────────────────────

async function processContract(
  tenantId: string,
  contract: any,
  today: string,
  milestones: number[],
  msg: any,
  cfg: TenantCfg = DEFAULT_CFG,
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
    const routing = await loadRouting(tenantId, contract, cfg);
    await db.transaction(async (tx) => {
      for (const milestone of newMilestones) {
        // Publish notification event to HR_Admin, manager, employee
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId,
          actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
          correlationId: msg.correlationId,
          payload: {
            tenantId,
            recipients: routing.recipients,
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
              ...routing.extra,
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
          updatedBy: msg.actorId ?? SYSTEM_ACTOR_ID,
          updatedAt: new Date(),
        })
        .where(
          and(eq(hrmsContracts.id, contract.id), eq(hrmsContracts.tenantId, tenantId)),
        );
    });

    await cache.invalidate(contractCacheKey(tenantId, contract.id));
    await cache.invalidate(dashboardCacheKey(tenantId));
    await projectAfter(tenantId, contract.employeeId);
    log.info({ tenantId, contractId: contract.id }, "contract transitioned to expiring");
  }

  // (f) If endDate has passed (daysRemaining <= 0) and no approved renewal: auto-separate
  if (daysRemaining <= 0) {
    const pendingRenewal = await getPendingRenewalForContract(tenantId, contract.id);
    // getPendingRenewalForContract checks for pending_approval status;
    // we also need to check if there's an approved renewal — no approved renewal means separate
    if (!pendingRenewal && cfg.policy.action === "flag_only") {
      // S8 G5: this tenant keeps the contract in force and flags HR instead of separating anyone.
      await flagLapse(tenantId, contract, daysRemaining, cfg, msg);
    } else if (!pendingRenewal) {
      await db.transaction(async (tx) => {
        // Transition to expired
        await tx
          .update(hrmsContracts)
          .set({
            status: "expired",
            updatedBy: msg.actorId ?? SYSTEM_ACTOR_ID,
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
          actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
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
          actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
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
      await projectAfter(tenantId, contract.employeeId);
      log.info({ tenantId, contractId: contract.id }, "contract expired, auto-separation triggered");
    }

    return; // Already expired — no further processing needed
  }

  // (g) If within 15 days and no Renewal_Record exists: escalate
  if (daysRemaining <= 15 && daysRemaining > 0) {
    const pendingRenewal = await getPendingRenewalForContract(tenantId, contract.id);
    if (!pendingRenewal && contract.status !== "escalated") {
      const routing = await loadRouting(tenantId, contract, cfg);
      await db.transaction(async (tx) => {
        // Transition to escalated
        await tx
          .update(hrmsContracts)
          .set({
            status: "escalated",
            updatedBy: msg.actorId ?? SYSTEM_ACTOR_ID,
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
          actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
          correlationId: msg.correlationId,
          payload: {
            tenantId,
            recipients: routing.recipients,
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
          actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
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
      await projectAfter(tenantId, contract.employeeId);
      log.info({ tenantId, contractId: contract.id, daysRemaining }, "contract escalated — no renewal initiated");
    }
  }
}

// ─── S8 G5 helpers ───────────────────────────────────────────────────────────

/** Refresh the employee read-model after a status change (own small tx; idempotent; no-op unless the tenant opted in). */
async function projectAfter(tenantId: string, employeeId: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await syncEmployeeContractProjection(tx, tenantId, employeeId);
    });
    await invalidateEmployeeCache(tenantId, employeeId);
  } catch (err: unknown) {
    // The nightly reconcile repairs a missed refresh; never let it fail the lapse handling itself.
    log.error({ tenantId, employeeId, error: err instanceof Error ? err.message : String(err) }, "employee contract projection refresh failed");
  }
}

/**
 * Who a contract alert goes to. With no notify_roles configured (every existing tenant) this is exactly the
 * old routing: the employee, and the hr_admin/manager roles named in the notification. With notify_roles set,
 * the employee's project manager and/or line manager are added by id and the project is named in the data.
 */
async function loadRouting(
  tenantId: string,
  contract: any,
  cfg: TenantCfg,
): Promise<{ recipients: string[]; extra: Record<string, unknown> }> {
  if (cfg.notifyRoles.length === 0) return { recipients: [contract.employeeId], extra: {} };
  const rows = await scopedRead((tx) =>
    tx
      .select({ managerId: hrmsEmployees.managerId, projectManagerId: hrmsEmployees.projectManagerId })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.id, contract.employeeId)))
      .limit(1),
  );
  const proj = projectFromTerms(contract.terms);
  return {
    recipients: routeRecipients(rows[0] ?? null, contract.employeeId, cfg.notifyRoles),
    extra: {
      ...(proj.projectCode ? { projectCode: proj.projectCode } : {}),
      ...(proj.projectName ? { projectName: proj.projectName } : {}),
    },
  };
}

/**
 * flag_only: the end date has passed and no renewal is in flight. Never expires the contract and never
 * separates. Sends one "lapsed, decide" flag to HR on the lapse day, and one escalation once grace_days have
 * passed. Both are deduplicated through the notifications table (marks 0 and -1) and audited.
 */
async function flagLapse(tenantId: string, contract: any, daysRemaining: number, cfg: TenantCfg, msg: any): Promise<void> {
  const sent = await getSentMilestones(tenantId, contract.id);
  const due = flagOnlyDue(-daysRemaining, cfg.policy.graceDays).filter((m) => !sent.includes(m));
  if (due.length === 0) return;
  const routing = await loadRouting(tenantId, contract, cfg);
  await db.transaction(async (tx) => {
    for (const mark of due) {
      const first = mark === LAPSE_FLAGGED_MARK;
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: NOTIFICATION_SEND,
        tenantId,
        actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
        correlationId: msg.correlationId,
        payload: {
          tenantId,
          recipients: routing.recipients,
          roles: first ? ["hr_admin"] : ["hr_admin", "department_head"],
          channels: ["email", "in_app"],
          template: first ? "contract_lapsed_flagged" : "contract_lapse_grace_elapsed",
          data: {
            contractId: contract.id,
            contractNo: contract.contractNo,
            employeeId: contract.employeeId,
            endDate: contract.endDate,
            daysPastEnd: -daysRemaining,
            graceDays: cfg.policy.graceDays,
            ...routing.extra,
          },
        },
      });
      await tx.insert(hrmsContractNotifications).values({ tenantId, contractId: contract.id, milestone: mark });
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId,
        actorId: msg.actorId ?? SYSTEM_ACTOR_ID,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE, action: first ? "lapse_flagged" : "lapse_grace_elapsed", resourceType: "contract",
          resourceId: contract.id, outcome: "success", reason: "lapse_action_flag_only",
        },
      });
    }
  });
  log.info({ tenantId, contractId: contract.id, marks: due }, "contract lapse flagged (flag_only tenant, not separated)");
}

/** Per-tenant extras after the contract loop: repair the employee read-model, and the Monday HR digest. */
async function runTenantExtras(tenantId: string, today: string, live: any): Promise<void> {
  if (live?.employeeProjectionEnabled === true) {
    try {
      let ids: string[] = [];
      await db.transaction(async (tx) => {
        ids = (await reconcileTenantProjection(tx, tenantId, true)).repairedIds;
      });
      for (const id of ids) await invalidateEmployeeCache(tenantId, id);
      if (ids.length > 0) log.warn({ tenantId, repaired: ids.length }, "employee contract projection drift repaired");
    } catch (err: unknown) {
      log.error({ tenantId, error: err instanceof Error ? err.message : String(err) }, "employee contract projection reconcile failed");
    }
  }
  if (live?.weeklyDigestEnabled === true && isDigestDay(today)) {
    try {
      await sendWeeklyDigest(tenantId, today);
    } catch (err: unknown) {
      log.error({ tenantId, error: err instanceof Error ? err.message : String(err) }, "weekly contract digest failed");
    }
  }
}

export async function sendWeeklyDigest(tenantId: string, today: string): Promise<void> {
  const windowDays = 30;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + windowDays);
  const windowEnd = limit.toISOString().slice(0, 10);
  const rows = await scopedRead(async (tx) => {
    const cs = await tx
      .select({ id: hrmsContracts.id, endDate: hrmsContracts.endDate })
      .from(hrmsContracts)
      .where(and(
        eq(hrmsContracts.tenantId, tenantId),
        inArray(hrmsContracts.status, [...IN_FORCE]),
        gte(hrmsContracts.endDate, today),
        lte(hrmsContracts.endDate, windowEnd),
      ));
    if (cs.length === 0) return [];
    const rn = await tx
      .select({ contractId: hrmsContractRenewals.contractId })
      .from(hrmsContractRenewals)
      .where(and(
        eq(hrmsContractRenewals.tenantId, tenantId),
        inArray(hrmsContractRenewals.contractId, cs.map((c) => c.id)),
        inArray(hrmsContractRenewals.status, ["pending_approval", "approved"]),
      ));
    const has = new Set(rn.map((r) => r.contractId));
    return cs.map((c) => ({ endDate: c.endDate as string, hasRenewalRequest: has.has(c.id) }));
  });
  const d = buildDigest(rows, today, windowDays);
  if (d.endingSoon === 0) return;
  await db.transaction(async (tx) => {
    await enqueue(tx, {
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      tenantId,
      actorId: SYSTEM_ACTOR_ID,
      correlationId: crypto.randomUUID(),
      payload: {
        tenantId,
        recipients: [],
        roles: ["hr_admin"],
        channels: ["email", "in_app"],
        template: "contract_expiry_weekly_digest",
        data: { windowDays, endingSoon: d.endingSoon, withoutRenewal: d.withoutRenewal, asOf: today },
      },
    });
  });
}
