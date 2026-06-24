import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as schemeRepo from "../scheme/repo.js";
import { checkEligibility } from "../scheme/domain.js";
import * as beneficiaryRepo from "../beneficiary/repo.js";
import { assertTransition } from "./domain.js";

/** Indian financial year (Apr-Mar) for a given date, formatted e.g. "2026-27". */
function indianFinancialYear(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 3 ? y : y - 1; // months are 0-based; Apr = 3
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

export function registerApplicationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.applicationSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; schemeId: string;
      beneficiaryId: string; purpose: string; amountRequestedMinor: number; currency?: string;
    };

    // Eligibility check — runs before DB write
    const criteria = await schemeRepo.findCriteriaByScheme(p.schemeId);
    if (criteria.length > 0) {
      const ben = await beneficiaryRepo.findBeneficiaryById(p.beneficiaryId, p.tenantId);
      if (ben) {
        const profile: import("../scheme/domain.js").BeneficiaryProfile = {
          incomeAnnualMinor: ben.incomeAnnualMinor,
        };
        if (ben.age != null) profile.age = ben.age;
        if (ben.category) profile.category = ben.category;
        if (ben.geography) profile.geography = ben.geography;
        const result = checkEligibility(criteria, profile);
        if (!result.eligible) {
          await db.transaction(async (tx) => {
            if (!(await markProcessed(tx, msg.messageId))) return;
            await enqueue(tx, {
              topic: EVENTS.applicationRejected, eventType: EVENTS.applicationRejected,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: { applicationId: p.id, reason: `eligibility_failed: ${result.reason}` },
            });
            await audit(tx, msg, "eligibility_rejected", "grant_application", p.id, "failure");
          });
          return;
        }
      }
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const grantNo = await repo.allocateSanctionNo(tx, p.tenantId, indianFinancialYear());
      await repo.insertApplication(tx, {
        id: p.id, tenantId: p.tenantId, grantNo, schemeId: p.schemeId,
        beneficiaryId: p.beneficiaryId, purpose: p.purpose,
        amountRequestedMinor: BigInt(p.amountRequestedMinor),
        amountApprovedMinor: 0n,
        currency: p.currency ?? "INR",
        status: "submitted",
        submittedAt: new Date(),
        submittedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "submit", "grant_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationScore, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; reviewerRef: string;
      technicalScore: number; financialScore: number; recommendation?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findApplicationByIdTx(tx, p.id, p.tenantId);
      if (!app) return;
      assertTransition(app.status, "under_review");
      await repo.updateApplication(tx, p.id, { status: "under_review", updatedBy: msg.actorId });
      const totalScore = (p.technicalScore + p.financialScore) / 2;
      await repo.insertScore(tx, {
        id: undefined as any,
        tenantId: p.tenantId,
        applicationId: p.id,
        reviewerRef: p.reviewerRef,
        technicalScore: p.technicalScore.toString(),
        financialScore: p.financialScore.toString(),
        totalScore: totalScore.toString(),
        recommendation: p.recommendation ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "score", "grant_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; amountApprovedMinor: number; approvedBy?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findApplicationByIdTx(tx, p.id, p.tenantId);
      if (!app) return;
      // P0-4 SoD (defence in depth): never approve when approver == submitter.
      const approver = p.approvedBy ?? msg.actorId;
      if (app.submittedBy && app.submittedBy === approver) {
        await enqueue(tx, {
          topic: EVENTS.applicationRejected, eventType: "grant.application.sod_violation",
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { applicationId: p.id, reason: "SOD_VIOLATION: approver must differ from submitter" },
        });
        await audit(tx, msg, "approve", "grant_application", p.id, "failure");
        return;
      }
      assertTransition(app.status, "approved");
      await repo.updateApplication(tx, p.id, {
        status: "approved",
        amountApprovedMinor: BigInt(p.amountApprovedMinor),
        approvedAt: new Date(),
        approvedBy: approver,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.applicationApproved, eventType: EVENTS.applicationApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { applicationId: p.id, amountApprovedMinor: p.amountApprovedMinor },
      });
      const beneficiary = await beneficiaryRepo.findBeneficiaryById(app.beneficiaryId, app.tenantId);
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.applicationApproved,
          recipient: beneficiary?.id ?? app.beneficiaryId,
          recipientId: app.beneficiaryId,
          variables: {
            applicationId: p.id,
            amountApprovedMinor: String(p.amountApprovedMinor),
          },
        }),
      });
      await audit(tx, msg, "approve", "grant_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findApplicationByIdTx(tx, p.id, p.tenantId);
      if (!app) return;
      assertTransition(app.status, "rejected");
      await repo.updateApplication(tx, p.id, {
        status: "rejected",
        rejectionReason: p.reason,
        rejectedAt: new Date(),
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.applicationRejected, eventType: EVENTS.applicationRejected,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { applicationId: p.id, reason: p.reason },
      });
      await audit(tx, msg, "reject", "grant_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string, outcome: "success" | "failure" = "success"): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome },
  });
}
