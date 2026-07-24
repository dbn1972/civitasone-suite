import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS, SERVICE } from "../../topics.js";
import { hrmsContracts, hrmsContractRenewals } from "./schema.js";
import { assertValidTransition, canRenew, DomainError } from "./domain.js";
import {
  getContractById,
  getActiveContractForEmployee,
  getPendingRenewalForContract,
  getNextContractNo,
  getRenewalById,
  getContractConfig,
  getContractHistory,
} from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { eq, and } from "drizzle-orm";
import type { ContractStatus } from "./types.js";

const log = pino({ name: "contract-consumer" });
const AUDIT = "audit.event.record";
const NOTIFICATION_SEND = "notification.send";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function audit(
  tx: any,
  msg: any,
  action: string,
  resourceType: string,
  resourceId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType, resourceId, outcome: "success", ...extra },
  });
}

function contractCacheKey(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, "contract", id);
}

function employeeActiveCacheKey(tenantId: string, employeeId: string): string {
  return `${SERVICE}:${tenantId}:contract:employee:${employeeId}:active`;
}

function employeeHistoryCacheKey(tenantId: string, employeeId: string): string {
  return `${SERVICE}:${tenantId}:contract:employee:${employeeId}:history`;
}

function renewalCacheKey(tenantId: string, id: string): string {
  return `${SERVICE}:${tenantId}:contract:renewal:${id}`;
}

function dashboardCacheKey(tenantId: string): string {
  return `${SERVICE}:${tenantId}:contract:dashboard:expiring`;
}

function configCacheKey(tenantId: string): string {
  return `${SERVICE}:${tenantId}:contract:config`;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerContractConsumers(queue: Queue): void {
  // ─── 6.1 Contract Lifecycle Commands ─────────────────────────────────────

  queue.subscribe(COMMANDS.contractCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      startDate: string;
      endDate: string;
      terms: Record<string, unknown>;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Validate employee type is "contract"
      const employee = await employeeRepo.findById(p.employeeId, p.tenantId);
      if (!employee) {
        throw new NonRetryableError(`Employee not found: ${p.employeeId}`);
      }
      if (employee.employeeType !== "contract") {
        throw new NonRetryableError(
          `Employee ${p.employeeId} is type '${employee.employeeType}', expected 'contract'`,
        );
      }

      // Check no active contract exists
      const existing = await getActiveContractForEmployee(p.tenantId, p.employeeId);
      if (existing) {
        throw new NonRetryableError(
          `Active contract already exists for employee ${p.employeeId}: ${existing.id}`,
        );
      }

      // Generate contract number
      const contractNo = await getNextContractNo(tx, p.tenantId);

      // Insert contract (status: draft)
      await tx.insert(hrmsContracts).values({
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        contractNo,
        startDate: p.startDate,
        endDate: p.endDate,
        terms: p.terms,
        renewalCount: 0,
        status: "draft",
        previousContractId: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Emit contractCreated event + audit
      await enqueue(tx, {
        topic: EVENTS.contractCreated,
        eventType: EVENTS.contractCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { contractId: p.id, contractNo, employeeId: p.employeeId, tenantId: p.tenantId },
      });
      await audit(tx, msg, "create", "contract", p.id);
    });

    // Cache invalidation after transaction commits
    await cache.invalidate(contractCacheKey(p.tenantId, p.id));
    await cache.invalidate(employeeActiveCacheKey(p.tenantId, p.employeeId));
    await cache.invalidate(employeeHistoryCacheKey(p.tenantId, p.employeeId));
    await cache.invalidate(dashboardCacheKey(p.tenantId));
    log.info({ messageId: msg.messageId, contractId: p.id }, "contract created");
  });

  queue.subscribe(COMMANDS.contractActivate, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      contractId: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const contract = await getContractById(p.tenantId, p.contractId);
      if (!contract) {
        throw new NonRetryableError(`Contract not found: ${p.contractId}`);
      }

      try {
        assertValidTransition(contract.status as ContractStatus, "active");
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }

      await tx
        .update(hrmsContracts)
        .set({ status: "active", updatedBy: msg.actorId, updatedAt: new Date() })
        .where(
          and(eq(hrmsContracts.id, p.contractId), eq(hrmsContracts.tenantId, p.tenantId)),
        );

      await audit(tx, msg, "activate", "contract", p.contractId);
    });

    await cache.invalidate(contractCacheKey(p.tenantId, p.contractId));
    await cache.invalidate(dashboardCacheKey(p.tenantId));
    log.info({ messageId: msg.messageId, contractId: p.contractId }, "contract activated");
  });

  queue.subscribe(COMMANDS.contractTerminate, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      contractId: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const contract = await getContractById(p.tenantId, p.contractId);
      if (!contract) {
        throw new NonRetryableError(`Contract not found: ${p.contractId}`);
      }

      try {
        assertValidTransition(contract.status as ContractStatus, "terminated");
      } catch (err) {
        if (err instanceof DomainError) throw new NonRetryableError(err.message);
        throw err;
      }

      await tx
        .update(hrmsContracts)
        .set({ status: "terminated", updatedBy: msg.actorId, updatedAt: new Date() })
        .where(
          and(eq(hrmsContracts.id, p.contractId), eq(hrmsContracts.tenantId, p.tenantId)),
        );

      await audit(tx, msg, "terminate", "contract", p.contractId);
    });

    await cache.invalidate(contractCacheKey(p.tenantId, p.contractId));
    await cache.invalidate(dashboardCacheKey(p.tenantId));
    log.info({ messageId: msg.messageId, contractId: p.contractId }, "contract terminated");
  });

  // ─── 6.2 Renewal Initiation ────────────────────────────────────────────────

  queue.subscribe(COMMANDS.contractRenewalInitiate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      contractId: string;
      newEndDate: string;
      newTerms: Record<string, unknown>;
      initiatedBy: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const contract = await getContractById(p.tenantId, p.contractId);
      if (!contract) {
        throw new NonRetryableError(`Contract not found: ${p.contractId}`);
      }

      const status = contract.status as ContractStatus;

      // If escalated, transition to expiring first
      if (status === "escalated") {
        try {
          assertValidTransition("escalated", "expiring");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }
        await tx
          .update(hrmsContracts)
          .set({ status: "expiring", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(
            and(eq(hrmsContracts.id, p.contractId), eq(hrmsContracts.tenantId, p.tenantId)),
          );
      } else if (status !== "active" && status !== "expiring") {
        throw new NonRetryableError(
          `Contract ${p.contractId} status '${status}' is not valid for renewal (must be active, expiring, or escalated)`,
        );
      }

      // Check no pending renewal exists
      const pendingRenewal = await getPendingRenewalForContract(p.tenantId, p.contractId);
      if (pendingRenewal) {
        throw new NonRetryableError(
          `Pending renewal already exists for contract ${p.contractId}: ${pendingRenewal.id}`,
        );
      }

      // Check max duration not exceeded
      const config = await getContractConfig(p.tenantId);
      const history = await getContractHistory(p.tenantId, contract.employeeId) ?? [];
      const maxMonths = (config as any)?.maxContractMonths ?? null;
      const eligibility = canRenew(
        history.map((c: any) => ({ startDate: c.startDate, endDate: c.endDate })),
        p.newEndDate,
        maxMonths,
      );
      if (!eligibility.allowed) {
        throw new NonRetryableError(
          `Max contract duration exceeded: total ${eligibility.totalMonths} months exceeds limit of ${eligibility.maxMonths} months`,
        );
      }

      // Determine renewal number
      const renewalNumber = (contract.renewalCount as number) + 1;

      // Create Renewal Record
      const approvalChain = (config as any)?.approvalChain ?? [];
      await tx.insert(hrmsContractRenewals).values({
        id: p.id,
        tenantId: p.tenantId,
        contractId: p.contractId,
        renewalNumber,
        initiatedBy: p.initiatedBy ?? msg.actorId,
        status: "pending_approval",
        newEndDate: p.newEndDate,
        originalTerms: contract.terms as Record<string, unknown>,
        newTerms: p.newTerms,
        approvalChain,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Submit to workflow-service via outbox (HTTP POST is handled by relay/integration)
      await enqueue(tx, {
        topic: "workflow.instance.create",
        eventType: "workflow.instance.create",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          entityType: "contract_renewal",
          entityId: p.id,
          tenantId: p.tenantId,
          approvalChain,
          context: {
            contractId: p.contractId,
            contractNo: contract.contractNo,
            employeeId: contract.employeeId,
            newEndDate: p.newEndDate,
            newTerms: p.newTerms,
          },
        },
      });

      await audit(tx, msg, "renewal_initiate", "contract_renewal", p.id);
    });

    await cache.invalidate(contractCacheKey(p.tenantId, p.contractId));
    await cache.invalidate(renewalCacheKey(p.tenantId, p.id));
    await cache.invalidate(dashboardCacheKey(p.tenantId));
    log.info({ messageId: msg.messageId, renewalId: p.id }, "contract renewal initiated");
  });

  // ─── 6.3 Renewal Decision Callback ─────────────────────────────────────────

  queue.subscribe(CONSUMED_EVENTS.contractRenewalDecided, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      renewalId: string;
      decision: "approved" | "rejected";
      decidedBy: string;
      rejectionReason?: string;
      budgetCheck?: { available: boolean; shortfallMinor?: number; budgetRef?: string };
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const renewal = await getRenewalById(p.tenantId, p.renewalId);
      if (!renewal) {
        throw new NonRetryableError(`Renewal not found: ${p.renewalId}`);
      }

      const contract = await getContractById(p.tenantId, renewal.contractId);
      if (!contract) {
        throw new NonRetryableError(`Contract not found: ${renewal.contractId}`);
      }

      // Budget check: if finance step flagged insufficient
      if (p.budgetCheck && !p.budgetCheck.available) {
        await tx
          .update(hrmsContractRenewals)
          .set({
            status: "budget_insufficient",
            budgetRef: p.budgetCheck.budgetRef ?? null,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(hrmsContractRenewals.id, p.renewalId),
              eq(hrmsContractRenewals.tenantId, p.tenantId),
            ),
          );

        // Notify about budget insufficiency
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            tenantId: p.tenantId,
            recipients: [contract.employeeId],
            channels: ["email", "in_app"],
            template: "contract_renewal_budget_insufficient",
            data: {
              contractNo: contract.contractNo,
              shortfallMinor: p.budgetCheck.shortfallMinor,
            },
          },
        });

        await audit(tx, msg, "renewal_budget_insufficient", "contract_renewal", p.renewalId);
        return;
      }

      if (p.decision === "approved") {
        // Update renewal to approved
        await tx
          .update(hrmsContractRenewals)
          .set({
            status: "approved",
            approvedBy: p.decidedBy,
            approvedAt: new Date(),
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(hrmsContractRenewals.id, p.renewalId),
              eq(hrmsContractRenewals.tenantId, p.tenantId),
            ),
          );

        // Create new contract linked via previousContractId
        const newContractNo = await getNextContractNo(tx, p.tenantId);
        const newContractId = crypto.randomUUID();

        await tx.insert(hrmsContracts).values({
          id: newContractId,
          tenantId: p.tenantId,
          employeeId: contract.employeeId,
          contractNo: newContractNo,
          startDate: contract.endDate, // new contract starts where old ended
          endDate: renewal.newEndDate,
          terms: renewal.newTerms as Record<string, unknown>,
          renewalCount: (contract.renewalCount as number) + 1,
          status: "draft",
          previousContractId: contract.id,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        // Update renewal with new contract reference
        await tx
          .update(hrmsContractRenewals)
          .set({ newContractId })
          .where(
            and(
              eq(hrmsContractRenewals.id, p.renewalId),
              eq(hrmsContractRenewals.tenantId, p.tenantId),
            ),
          );

        // Transition old contract to "renewed"
        await tx
          .update(hrmsContracts)
          .set({ status: "renewed", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(
            and(eq(hrmsContracts.id, contract.id), eq(hrmsContracts.tenantId, p.tenantId)),
          );

        // Emit contractRenewed event
        await enqueue(tx, {
          topic: EVENTS.contractRenewed,
          eventType: EVENTS.contractRenewed,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            contractId: contract.id,
            newContractId,
            renewalId: p.renewalId,
            employeeId: contract.employeeId,
            tenantId: p.tenantId,
          },
        });

        await audit(tx, msg, "renewal_approved", "contract_renewal", p.renewalId);
      } else {
        // Decision is "rejected"
        await tx
          .update(hrmsContractRenewals)
          .set({
            status: "rejected",
            rejectedBy: p.decidedBy,
            rejectedAt: new Date(),
            rejectionReason: p.rejectionReason ?? null,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(hrmsContractRenewals.id, p.renewalId),
              eq(hrmsContractRenewals.tenantId, p.tenantId),
            ),
          );

        // Notify about rejection
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            tenantId: p.tenantId,
            recipients: [contract.employeeId],
            channels: ["email", "in_app"],
            template: "contract_renewal_rejected",
            data: {
              contractNo: contract.contractNo,
              rejectionReason: p.rejectionReason,
            },
          },
        });

        await audit(tx, msg, "renewal_rejected", "contract_renewal", p.renewalId);
      }
    });

    await cache.invalidate(renewalCacheKey(p.tenantId, p.renewalId));
    await cache.invalidate(dashboardCacheKey(p.tenantId));
    // Invalidate contract caches (renewal affects contract status)
    const renewal = await getRenewalById(p.tenantId, p.renewalId);
    if (renewal) {
      await cache.invalidate(contractCacheKey(p.tenantId, renewal.contractId));
      const contract = await getContractById(p.tenantId, renewal.contractId);
      if (contract) {
        await cache.invalidate(employeeActiveCacheKey(p.tenantId, contract.employeeId));
        await cache.invalidate(employeeHistoryCacheKey(p.tenantId, contract.employeeId));
      }
    }
    log.info({ messageId: msg.messageId, renewalId: p.renewalId, decision: p.decision }, "contract renewal decided");
  });

  // ─── 6.4 Bulk Renewal ──────────────────────────────────────────────────────

  queue.subscribe(COMMANDS.contractRenewalBulk, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      contractIds: string[];
      newEndDate: string;
      newTerms: Record<string, unknown>;
      initiatedBy: string;
    };

    const results: Array<{ contractId: string; success: boolean; renewalId?: string; error?: string }> = [];

    for (const contractId of p.contractIds) {
      try {
        const renewalId = crypto.randomUUID();

        await db.transaction(async (tx) => {
          // Validate contract independently
          const contract = await getContractById(p.tenantId, contractId);
          if (!contract) {
            throw new NonRetryableError(`Contract not found: ${contractId}`);
          }

          const status = contract.status as ContractStatus;
          if (status !== "active" && status !== "expiring") {
            throw new NonRetryableError(
              `Contract ${contractId} status '${status}' is not valid for renewal`,
            );
          }

          // Check no pending renewal
          const pendingRenewal = await getPendingRenewalForContract(p.tenantId, contractId);
          if (pendingRenewal) {
            throw new NonRetryableError(`Pending renewal already exists for contract ${contractId}`);
          }

          // Check max duration
          const config = await getContractConfig(p.tenantId);
          const history = await getContractHistory(p.tenantId, contract.employeeId) ?? [];
          const maxMonths = (config as any)?.maxContractMonths ?? null;
          const eligibility = canRenew(
            history.map((c: any) => ({ startDate: c.startDate, endDate: c.endDate })),
            p.newEndDate,
            maxMonths,
          );
          if (!eligibility.allowed) {
            throw new NonRetryableError(
              `Max duration exceeded for contract ${contractId}`,
            );
          }

          const renewalNumber = (contract.renewalCount as number) + 1;
          const approvalChain = (config as any)?.approvalChain ?? [];

          // Create individual renewal record
          await tx.insert(hrmsContractRenewals).values({
            id: renewalId,
            tenantId: p.tenantId,
            contractId,
            renewalNumber,
            initiatedBy: p.initiatedBy ?? msg.actorId,
            status: "pending_approval",
            newEndDate: p.newEndDate,
            originalTerms: contract.terms as Record<string, unknown>,
            newTerms: p.newTerms,
            approvalChain,
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
          });

          await audit(tx, msg, "bulk_renewal_initiate", "contract_renewal", renewalId);
        });

        results.push({ contractId, success: true, renewalId });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ contractId, success: false, error: errorMsg });
        log.warn({ contractId, error: errorMsg }, "bulk renewal: contract failed");
      }
    }

    // Emit audit for the bulk operation
    await db.transaction(async (tx) => {
      await audit(tx, msg, "bulk_renewal_complete", "contract_renewal_bulk", msg.messageId, {
        total: p.contractIds.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      });
    });

    await cache.invalidate(dashboardCacheKey(p.tenantId));
    log.info(
      { messageId: msg.messageId, total: p.contractIds.length, succeeded: results.filter((r) => r.success).length },
      "bulk renewal processed",
    );
  });

  // ─── 6.5 Auto-Separation ──────────────────────────────────────────────────

  queue.subscribe(COMMANDS.contractAutoSeparate, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      contractId: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const contract = await getContractById(p.tenantId, p.contractId);
      if (!contract) {
        throw new NonRetryableError(`Contract not found: ${p.contractId}`);
      }

      const config = await getContractConfig(p.tenantId);
      const autoSeparationEnabled = (config as any)?.autoSeparationEnabled ?? true;

      if (autoSeparationEnabled) {
        // Publish separation command
        await enqueue(tx, {
          topic: COMMANDS.lifecycleSeparate,
          eventType: COMMANDS.lifecycleSeparate,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            tenantId: p.tenantId,
            employeeId: contract.employeeId,
            separationType: "contract_expiry",
            contractId: p.contractId,
            effectiveDate: contract.endDate,
          },
        });

        // Transition contract to expired
        await tx
          .update(hrmsContracts)
          .set({ status: "expired", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(
            and(eq(hrmsContracts.id, p.contractId), eq(hrmsContracts.tenantId, p.tenantId)),
          );

        // Emit contractSeparated event
        await enqueue(tx, {
          topic: EVENTS.contractSeparated,
          eventType: EVENTS.contractSeparated,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            contractId: p.contractId,
            employeeId: contract.employeeId,
            tenantId: p.tenantId,
            separationType: "contract_expiry",
          },
        });

        await audit(tx, msg, "auto_separate", "contract", p.contractId);
      } else {
        // Auto-separation disabled: send alert notification to HR_Admin only
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            tenantId: p.tenantId,
            recipients: [],
            roles: ["hr_admin"],
            channels: ["email", "in_app"],
            template: "contract_expiry_alert_no_separation",
            data: {
              contractId: p.contractId,
              contractNo: contract.contractNo,
              employeeId: contract.employeeId,
              endDate: contract.endDate,
            },
          },
        });

        await audit(tx, msg, "auto_separate_skipped", "contract", p.contractId, {
          reason: "auto_separation_disabled",
        });
      }
    });

    await cache.invalidate(contractCacheKey(p.tenantId, p.contractId));
    await cache.invalidate(dashboardCacheKey(p.tenantId));
    log.info({ messageId: msg.messageId, contractId: p.contractId }, "contract auto-separation processed");
  });

  log.info("contract consumers registered");
}
