import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../application/repo.js";
import * as schemeRepo from "../scheme/repo.js";
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
      mode: string; beneficiaryBankRef?: string; requireApproval?: boolean;
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
      // M1 FIX: use FOR UPDATE lock to prevent concurrent over-disbursement.
      const app = await appRepo.findApplicationByIdForUpdate(tx, installment.applicationId, installment.tenantId);
      if (app) {
        const alreadyDisbursed = await repo.sumDisbursedForApplication(tx, installment.applicationId, installment.tenantId);
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
          installment.tenantId,
          installment.installmentNo,
        );
        if (!ucExists) {
          await enqueue(tx, {
            topic: EVENTS.ucGateBlocked, eventType: EVENTS.ucGateBlocked,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              installmentId: p.installmentId, installmentNo: installment.installmentNo,
              applicationId: installment.applicationId,
              reason: "UC_GATE_BLOCKED: the prior tranche's Utilisation Certificate must be submitted AND validated before releasing the next tranche (PFMS rule)",
            },
          });
          return;
        }
      }

      // P0-5 scheme budget control: atomically reserve this installment against the
      // scheme budget AFTER all rejection gates (duplicate / approved / UC) have
      // passed, so a blocked tranche never leaks budget. The conditional UPDATE only
      // succeeds when disbursed_minor + amount <= budget_minor (tenant-scoped), so
      // concurrent disbursements cannot overspend the envelope. Reject (no EFT) on failure.
      {
        const appForBudget = await appRepo.findApplicationByIdTx(tx, installment.applicationId, installment.tenantId);
        const schemeId = appForBudget?.schemeId;
        if (schemeId) {
          const reserved = await schemeRepo.reserveSchemeBudget(
            tx, schemeId, installment.tenantId, installment.amountMinor,
          );
          if (!reserved) {
            await enqueue(tx, {
              topic: EVENTS.schemeBudgetExceeded, eventType: EVENTS.schemeBudgetExceeded,
              tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                installmentId: p.installmentId, schemeId,
                amountMinor: installment.amountMinor.toString(),
                reason: "SCHEME_BUDGET_EXCEEDED: disbursing this installment would exceed the scheme budget envelope",
              },
            });
            return;
          }
        }
      }

      // W1.3: Wire the real PFMS adapter for disbursement initiation.
      // In mock mode (default), returns a synthetic txnId. In sandbox/production,
      // calls the real PFMS e-Kuber API. Fail-closed when unconfigured.
      let pfmsTxnId: string;
      if (p.mode === "PFMS") {
        // `initiateDisbursement` is intentionally not called below anymore — see
        // the fail-closed comment in the isConfigured() branch.
        const { isConfigured } = await import("@civitasone/gov-adapters/pfms");
        if (isConfigured()) {
          // Resolve beneficiary details for PFMS submission. grant-service never
          // stores a full account number (DPDP masking — see beneficiary/schema.ts),
          // so a real (non-mock) PFMS call cannot be completed from local data alone.
          // Fail closed rather than send PFMS a blank/masked bank account: a rejected
          // or misrouted real disbursement to a citizen is worse than a loud failure
          // here, and this message will retry/DLQ instead of silently corrupting a
          // government payment request.
          // NonRetryableError: this is a permanent configuration/architecture gap,
          // not a transient failure — retrying with backoff would just fail the
          // same way every time and delay landing in the DLQ where a human can act
          // on it. See services/queue-service (bus.ts) for the retry-bypass contract.
          if (!p.beneficiaryBankRef) {
            throw new NonRetryableError(
              "PFMS_BANK_REF_MISSING: real PFMS disbursement requires beneficiaryBankRef",
            );
          }
          const beneficiary = await repo.findBeneficiaryByRef(tx, p.beneficiaryBankRef, p.tenantId);
          if (!beneficiary) {
            throw new NonRetryableError(
              `PFMS_BENEFICIARY_UNRESOLVED: no bank account found for ref ${p.beneficiaryBankRef}`,
            );
          }
          throw new NonRetryableError(
            "PFMS_FULL_ACCOUNT_UNAVAILABLE: grant-service only holds a masked account " +
            "number (account_no_masked); live PFMS submission needs the full account " +
            "number from a dedicated bank-details vault, which is not wired up yet. " +
            "Resolve via the vault integration before enabling PFMS_MODE=sandbox|production.",
          );
        } else {
          // Mock mode — generate a synthetic reference
          pfmsTxnId = `PFMS-MOCK-${p.id}`;
        }
      } else {
        pfmsTxnId = `${p.mode}-${p.id}`;
      }
      // R14: when approval-gated, hold the disbursement in pending_approval and
      // do NOT pay yet — the eOffice approval emits the single EFT. The scheme
      // budget is already reserved above (released on rejection). eft_emitted is
      // the idempotent guard that the disbursement is paid at most once.
      const gated = p.requireApproval === true;
      await repo.insertDisbursement(tx, {
        id: p.id, tenantId: p.tenantId, installmentId: p.installmentId,
        amountMinor: installment.amountMinor,
        currency: installment.currency,
        mode: p.mode, pfmsTxnId,
        beneficiaryBankRef: p.beneficiaryBankRef ?? null,
        status: gated ? "pending_approval" : "initiated",
        eftEmitted: !gated,
        retryCount: 0,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertPfmsRecord(tx, {
        id: randomUUID(), tenantId: p.tenantId, disbursementId: p.id,
        pfmsTxnId, reconciled: false, rawResponse: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (gated) {
        // Held for administrative approval — no payment, installment not yet disbursed.
        await audit(tx, msg, "disbursement_pending_approval", "grant_disbursement", p.id);
      } else {
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
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "installments", p.installmentId));
  });

  // Consumed from finance-service: finance.payment.made → mark disbursement completed
  queue.subscribe(CONSUMED_EVENTS.financePaid, async (msg) => {
    const p = msg.payload as { disbursementId?: string; pfmsTxnId?: string; outcome?: string };
    if (!p.disbursementId && !p.pfmsTxnId) return;
    const disbursement = p.disbursementId
      ? await (async () => {
          const { grantDisbursements } = await import("./schema.js");
          const { eq, and } = await import("drizzle-orm");
          const rows = await db.transaction(async (tx) =>
            tx.select().from(grantDisbursements)
              .where(and(eq(grantDisbursements.id, p.disbursementId!), eq(grantDisbursements.tenantId, msg.tenantId)))
              .limit(1));
          return rows[0] ?? null;
        })()
      : p.pfmsTxnId ? await repo.findDisbursementByPfmsTxnId(p.pfmsTxnId, msg.tenantId) : null;
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
      await audit(tx, msg, isSuccess ? "disbursement_completed" : "disbursement_failed", "grant_disbursement", disbursement.id, isSuccess ? "success" : "failure");
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
        const disbursement = await repo.findDisbursementByPfmsTxnId(rec.pfmsTxnId, p.tenantId);
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

  // Mark a disbursement as submitted to eOffice for administrative approval.
  // The decision returns on grant.disbursement.file_decided (see eoffice-consumer).
  queue.subscribe(COMMANDS.disbursementSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const disbursement = await repo.findDisbursementByIdTx(tx, p.id, p.tenantId);
      if (!disbursement) return;
      await repo.updateDisbursement(tx, p.id, { status: "pending_approval", updatedBy: msg.actorId });
      await audit(tx, msg, "submit_for_eoffice_approval", "grant_disbursement", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "disbursement", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string, outcome: "success" | "failure" = "success"): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome },
  });
}
