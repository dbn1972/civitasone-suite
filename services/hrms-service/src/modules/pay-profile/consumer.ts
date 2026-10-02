/**
 * PAY-PROFILES consumers: request (maker) and decide (checker).
 *
 * The routes validate up front and 4xx on anything they can see; these
 * handlers re-assert the invariants that can change between publish and
 * consume (row still pending, approver != requester, ordering against the
 * employee's active rows) and raise NonRetryableError rather than loop on a
 * request that can never succeed.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { hrmsPayProfiles } from "./schema.js";
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { fetchPayrollLockedThrough } from "../../shared/payroll-client.js";
import { hrmsEmployees } from "../employee/schema.js";
import { loadTypeCategoryResolver } from "../employee/engagement-policy.js";
import { planApproval, requiredPayOption, deputationTermsError, isPayProfile, applyMoneyTerms } from "./domain.js";
import type { PayProfileRequestPayload } from "./commands.js";

const log = pino({ name: "hrms-pay-profile" });
const AUDIT = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function audit(
  tx: Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType: "pay_profile", resourceId, outcome: "success", metadata },
  });
}

export function registerPayProfileConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.payProfileRequest, async (msg) => {
    const p = msg.payload as PayProfileRequestPayload & { id: string };
    if (!isPayProfile(p.payProfile)) throw new NonRetryableError(`unknown pay profile ${p.payProfile}`);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(hrmsPayProfiles).values({
        id: p.id,
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        payProfile: p.payProfile,
        effectiveFrom: p.effectiveFrom,
        status: "pending",
        deputationId: p.deputationId,
        consolidatedMonthlyMinor: p.consolidatedMonthlyMinor == null ? null : BigInt(p.consolidatedMonthlyMinor),
        deputationTerms: p.deputationTerms ?? null,
        orderRef: p.orderRef,
        remarks: p.remarks,
        requestedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      // A concurrent identical request (same employee + effective month,
      // pending/active) loses on the partial unique index; nothing to do.
      }).onConflictDoNothing();
      await audit(tx, msg, "request", p.id, {
        employeeId: p.employeeId, payProfile: p.payProfile, effectiveFrom: p.effectiveFrom, deputationId: p.deputationId,
        consolidatedMonthlyMinor: p.consolidatedMonthlyMinor, deputationTerms: p.deputationTerms ?? null,
      });
    });
    log.info({ messageId: msg.messageId }, "pay profile requested");
  });

  queue.subscribe(COMMANDS.payProfileDecide, async (msg) => {
    const p = msg.payload as { profileId: string; decision: "approve" | "reject"; note: string | null };
    const touched: { employeeId?: string; lockedRejection?: string } = {};

    // Approval re-checks, made OUTSIDE the write transaction (an HTTP call and
    // reads that open their own scoped transactions must not nest inside it):
    //  - the locked payroll period, re-read from payroll at decision time
    //    (a run may have been approved since the route accepted this). An
    //    unreachable payroll throws a plain (retryable) error -- never "assume
    //    unlocked";
    //  - the employee's engagement is still payroll-eligible.
    let lockedThrough: string | null = null;
    let eligible = true;
    if (p.decision === "approve") {
      const pre = await repo.findById(msg.tenantId, p.profileId);
      if (pre && pre.status === "pending") {
        lockedThrough = await fetchPayrollLockedThrough(msg.tenantId);
        const emp = (await scopedRead((tx) => tx.select({ employeeType: hrmsEmployees.employeeType }).from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.tenantId, msg.tenantId), eq(hrmsEmployees.id, pre.employeeId))).limit(1)))[0];
        const policy = emp ? (await loadTypeCategoryResolver(msg.tenantId))(emp.employeeType).policy : null;
        eligible = !!policy && policy.eligibleForPayroll && policy.paymentRoute.toLowerCase() === "payroll";
      }
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findByIdTx(tx, msg.tenantId, p.profileId);
      if (!row) throw new NonRetryableError(`pay profile ${p.profileId} not found`);
      if (row.status !== "pending") return; // already decided (redelivery / race)
      if (row.requestedBy === msg.actorId) {
        throw new NonRetryableError("SELF_APPROVAL_FORBIDDEN: a pay profile change must be decided by someone other than its requester");
      }
      touched.employeeId = row.employeeId;
      const decided = { decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: p.note, updatedBy: msg.actorId };

      if (p.decision === "reject") {
        await repo.updateTx(tx, msg.tenantId, row.id, { ...decided, status: "rejected" }, row.version);
        await audit(tx, msg, "reject", row.id, {
          employeeId: row.employeeId, payProfile: row.payProfile, effectiveFrom: row.effectiveFrom, decisionNote: p.note,
        });
        return;
      }

      // The period became locked after the request was accepted: the request
      // can never be applied, so it is closed as REJECTED with an explicit
      // reason (committed), and the message is then dead-lettered below.
      if (lockedThrough && row.effectiveFrom.slice(0, 7) <= lockedThrough) {
        const reason = `PERIOD_LOCKED: payroll is locked through ${lockedThrough}; a profile from ${row.effectiveFrom} can no longer be approved -- raise a new request from a later month`;
        await repo.updateTx(tx, msg.tenantId, row.id, { ...decided, status: "rejected", decisionNote: reason }, row.version);
        await audit(tx, msg, "reject", row.id, {
          employeeId: row.employeeId, payProfile: row.payProfile, effectiveFrom: row.effectiveFrom,
          decisionNote: reason, automatic: true, approverNote: p.note,
        });
        touched.lockedRejection = reason;
        return;
      }
      if (!eligible) {
        throw new NonRetryableError("PROFILE_ENGAGEMENT_MISMATCH: the employee's engagement is no longer paid through payroll");
      }

      // Re-check the deputation terms at approval time: they may have been
      // edited (or the deputation closed) since the request was made.
      if (!isPayProfile(row.payProfile)) throw new NonRetryableError(`unknown pay profile ${row.payProfile}`);
      const option = requiredPayOption(row.payProfile);
      if (option) {
        const dep = row.deputationId ? await repo.findDeputationTx(tx, msg.tenantId, row.deputationId) : null;
        if (!dep || dep.employeeId !== row.employeeId || dep.status !== "active" || dep.payOption !== option) {
          throw new NonRetryableError("DEPUTATION_NOT_APPLICABLE: the referenced deputation is missing, closed or carries a different pay option");
        }
        // Validate the terms that will actually be paid: the approved copy on
        // the profile over the live deputation.
        const live = repo.toDeputationTerms(dep);
        const termsError = deputationTermsError(row.deputationTerms ? applyMoneyTerms(live, row.deputationTerms) : live);
        if (termsError) throw new NonRetryableError(termsError);
      }

      const active = await repo.listActiveByEmployeeForUpdateTx(tx, msg.tenantId, row.employeeId);
      const plan = planApproval(row, active);
      if ("error" in plan) throw new NonRetryableError(plan.error);
      let closedPreviousEffectiveTo: string | null = null;
      if (plan.closeRowId) {
        const open = active.find((a) => a.id === plan.closeRowId)!;
        closedPreviousEffectiveTo = open.effectiveTo;
        await repo.updateTx(tx, msg.tenantId, open.id, { effectiveTo: plan.closeOn, updatedBy: msg.actorId }, open.version);
      }
      await repo.updateTx(tx, msg.tenantId, row.id, { ...decided, status: "active" }, row.version);
      await audit(tx, msg, "approve", row.id, {
        employeeId: row.employeeId, payProfile: row.payProfile, effectiveFrom: row.effectiveFrom,
        deputationId: row.deputationId, deputationTerms: row.deputationTerms ?? null,
        consolidatedMonthlyMinor: row.consolidatedMonthlyMinor == null ? null : row.consolidatedMonthlyMinor.toString(),
        decisionNote: p.note,
        closedProfileId: plan.closeRowId,
        closedPreviousEffectiveTo,
        closedNewEffectiveTo: plan.closeOn,
      });
    });
    if (touched.employeeId) await cache.invalidate(cache.makeKey(msg.tenantId, "employee", touched.employeeId));
    if (touched.lockedRejection) throw new NonRetryableError(touched.lockedRejection);
    log.info({ messageId: msg.messageId, decision: p.decision }, "pay profile decided");
  });

  log.info("pay-profile consumers registered");
}
