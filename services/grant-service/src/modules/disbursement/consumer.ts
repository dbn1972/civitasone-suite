import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../application/repo.js";
import * as ucRepo from "../utilisation/repo.js";
import { assertDisbursementWithinApproved, canRetryDisbursement, MAX_DISBURSEMENT_RETRIES } from "./domain.js";

async function notifyDisbursementOutcome(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  applicationId: string,
  eventType: string,
  variables: Record<string, string>,
): Promise<void> {
  const app = await appRepo.findApplicationByIdTx(tx, applicationId, msg.tenantId);
  if (!app) return;
  await enqueue(tx, {
    topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: buildNotificationPayload({
      eventType,
      recipient: app.beneficiaryId,
      recipientId: app.beneficiaryId,
      variables,
    }),
  });
}

export function registerDisbursementConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.installmentCreate, async (msg) => {
    const p = msg.payload as {
      applicationId: string; tenantId: string; currency: string;
      installments: Array<{ id: string; installmentNo: number; amountMinor: number; condition?: string; dueDate?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const inst of p.installments) {
        await repo.insertInstallment(tx, {
          id: inst.id, tenantId: p.tenantId, applicationId: p.applicationId,
          installmentNo: inst.installmentNo,
          amountMinor: BigInt(inst.amountMinor),
          currency: p.currency ?? "INR",
          status: "pending",
          condition: inst.condition ?? null,
          dueDate: inst.dueDate ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "create_installments", "grant_installment", p.applicationId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "installments", p.applicationId));
  });

  queue.subscribe(COMMANDS.disbursementInitiate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; installmentId: string;
      mode: string; beneficiaryBankRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const installment = await repo.findInstallmentByIdTx(tx, p.installmentId, p.tenantId);
      if (!installment) return;

      // Idempotency guard: installment already disbursed — reject duplicate
      if (installment.status === "disbursed") {
        await enqueue(tx, {
          topic: "grant.disbursement.duplicate", eventType: "grant.disbursement.duplicate",
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { installmentId: p.installmentId, reason: "DUPLICATE_DISBURSEMENT: this installment has already been disbursed" },
        });
        return;
      }

      // Guard: total disbursed must not exceed approved amount
      const app = await appRepo.findApplicationByIdTx(tx, installment.applicationId, installment.tenantId);
      if (app) {
        const alreadyDisbursed = await repo.sumDisbursedForApplication(tx, installment.applicationId);
        try {
          assertDisbursementWithinApproved(app.amountApprovedMinor, alreadyDisbursed, installment.amountMinor);
        } catch {
          await enqueue(tx, {
            topic: EVENTS.disbursementExceedsApproved, eventType: EVENTS.disbursementExceedsApproved,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { installmentId: p.installmentId, approved: app.amountApprovedMinor.toString(), alreadyDisbursed: alreadyDisbursed.toString() },
          });
          return;
        }
      }

      // PFMS critical rule: installment N+1 cannot be released unless a UC has been
      // submitted for the application (confirming utilisation of previous tranche).
      // Installment 1 (no = 1) is exempt from this gate; all subsequent installments require UC.
      if (installment.installmentNo > 1) {
        const ucExists = await ucRepo.hasSubmittedUcForApplication(
          installment.applicationId,
          installment.installmentNo,
        );
        if (!ucExists) {
          await enqueue(tx, {
            topic: EVENTS.disbursementExceedsApproved, eventType: "grant.disbursement.uc_gate_blocked",
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              installmentId: p.installmentId, installmentNo: installment.installmentNo,
              applicationId: installment.applicationId,
              reason: "UC_GATE_BLOCKED: a Utilisation Certificate must be submitted for the previous tranche before releasing the next tranche (PFMS rule)",
            },
          });
          return;
        }
      }

      const pfmsTxnId = `PFMS-${p.id}`;
      await repo.insertDisbursement(tx, {
        id: p.id, tenantId: p.tenantId, installmentId: p.installmentId,
        amountMinor: installment.amountMinor,
        currency: installment.currency,
        mode: p.mode, pfmsTxnId,
        beneficiaryBankRef: p.beneficiaryBankRef ?? null,
        status: "initiated",
        retryCount: 0,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertPfmsRecord(tx, {
        id: randomUUID(), tenantId: p.tenantId, disbursementId: p.id,
        pfmsTxnId, reconciled: false, rawResponse: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // Emit to finance-service for EFT payment — cannot call inside transaction (deadlock risk per CLAUDE.md §4)
      await enqueue(tx, {
        topic: "finance.payment.eft.initiate", eventType: "finance.payment.eft.initiate",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          disbursementId: p.id, installmentId: p.installmentId,
          amountMinor: installment.amountMinor.toString(), currency: installment.currency,
          pfmsTxnId, mode: p.mode,
          beneficiaryBankRef: p.beneficiaryBankRef,
        },
      });
      await repo.updateInstallment(tx, p.installmentId, { status: "disbursed", updatedBy: msg.actorId });
      await audit(tx, msg, "initiate_disbursement", "grant_disbursement", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "installments", p.installmentId));
  });

  // Consumed from finance-service: finance.payment.made → mark disbursement completed
  queue.subscribe(CONSUMED_EVENTS.financePaid, async (msg) => {
    const p = msg.payload as { disbursementId?: string; pfmsTxnId?: string; outcome?: string };
    if (!p.disbursementId && !p.pfmsTxnId) return;
    const disbursement = p.disbursementId
      ? await (async () => {
          const rows = await db.select().from((await import("./schema.js")).grantDisbursements)
            .where((await import("drizzle-orm")).eq((await import("./schema.js")).grantDisbursements.id, p.disbursementId!)).limit(1);
          return rows[0] ?? null;
        })()
      : p.pfmsTxnId ? await repo.findDisbursementByPfmsTxnId(p.pfmsTxnId) : null;
    if (!disbursement) return;
    const isSuccess = p.outcome !== "failure";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (!isSuccess && canRetryDisbursement(disbursement.retryCount ?? 0)) {
        const nextRetry = (disbursement.retryCount ?? 0) + 1;
        await repo.updateDisbursement(tx, disbursement.id, {
          status: "initiated",
          retryCount: nextRetry,
          failureReason: `eft_failed: retry ${nextRetry}/${MAX_DISBURSEMENT_RETRIES}`,
          updatedBy: msg.actorId,
        });
        const installment = await repo.findInstallmentByIdTx(tx, disbursement.installmentId, disbursement.tenantId);
        if (installment) {
          await enqueue(tx, {
            topic: "finance.payment.eft.initiate", eventType: "finance.payment.eft.initiate",
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              disbursementId: disbursement.id, installmentId: disbursement.installmentId,
              amountMinor: installment.amountMinor.toString(), currency: installment.currency,
              pfmsTxnId: disbursement.pfmsTxnId, mode: disbursement.mode,
              beneficiaryBankRef: disbursement.beneficiaryBankRef,
            },
          });
        }
        await audit(tx, msg, "disbursement_retry", "grant_disbursement", disbursement.id);
        return;
      }

      await repo.updateDisbursement(tx, disbursement.id, {
        status: isSuccess ? "completed" : "failed",
        disbursedAt: isSuccess ? new Date() : null,
        failureReason: !isSuccess ? "finance.payment.made: outcome=failure" : null,
        updatedBy: msg.actorId,
      });
      if (isSuccess && disbursement.pfmsTxnId) {
        await repo.markPfmsReconciled(tx, disbursement.id);
      }
      const eventTopic = isSuccess ? EVENTS.disbursementCompleted : EVENTS.disbursementFailed;
      await enqueue(tx, {
        topic: eventTopic, eventType: eventTopic,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { disbursementId: disbursement.id, installmentId: disbursement.installmentId },
      });
      const installment = await repo.findInstallmentByIdTx(tx, disbursement.installmentId, disbursement.tenantId);
      if (installment) {
        await notifyDisbursementOutcome(tx, msg, installment.applicationId, eventTopic, {
          disbursementId: disbursement.id,
          installmentId: disbursement.installmentId,
        });
      }
      await audit(tx, msg, isSuccess ? "disbursement_completed" : "disbursement_failed", "grant_disbursement", disbursement.id);
    });
  });

  queue.subscribe(COMMANDS.pfmsReconcile, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      records: Array<{ pfmsTxnId: string; status: string; rawResponse?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const rec of p.records) {
        const disbursement = await repo.findDisbursementByPfmsTxnId(rec.pfmsTxnId);
        if (!disbursement) continue;
        const isSuccess = rec.status === "completed";
        await repo.updateDisbursement(tx, disbursement.id, {
          status: isSuccess ? "completed" : "failed",
          disbursedAt: isSuccess ? new Date() : null,
          failureReason: !isSuccess ? `pfms_reconcile: ${rec.status}` : null,
          updatedBy: msg.actorId,
        });
        if (isSuccess) await repo.markPfmsReconciled(tx, disbursement.id);
        const eventTopic = isSuccess ? EVENTS.disbursementCompleted : EVENTS.disbursementFailed;
        await enqueue(tx, {
          topic: eventTopic, eventType: eventTopic,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { disbursementId: disbursement.id, pfmsTxnId: rec.pfmsTxnId },
        });
      }
      await audit(tx, msg, "pfms_reconcile", "grant_pfms_records", (msg.payload as any).id ?? "batch");
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome: "success" },
  });
}
