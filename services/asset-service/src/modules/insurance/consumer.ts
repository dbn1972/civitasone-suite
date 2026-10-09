import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "asset-insurance-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerInsuranceConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.insurancePolicyCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; assetId: string; policyNo: string; insurer: string;
        coverageMinor: number; premiumMinor: number; currency: string;
        startDate: string; endDate: string; renewalReminderDays: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertPolicy(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          policyNo: p.policyNo, insurer: p.insurer,
          coverageMinor: BigInt(p.coverageMinor), premiumMinor: BigInt(p.premiumMinor),
          currency: p.currency, startDate: p.startDate, endDate: p.endDate,
          renewalReminderDays: p.renewalReminderDays, status: "active",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "insurance_policy", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.insurancePolicyCreate }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.insuranceClaimCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; policyId: string; assetId: string;
        claimDate: string; claimAmountMinor: number; currency: string; notes?: string;
        attachments?: Array<{ key: string; fileName: string; size: number; mimeType: string }>;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertClaim(tx, {
          id: p.id, tenantId: p.tenantId, policyId: p.policyId, assetId: p.assetId,
          claimDate: p.claimDate, claimAmountMinor: BigInt(p.claimAmountMinor),
          currency: p.currency, status: "pending", settledAmountMinor: 0n,
          notes: p.notes ?? null, attachments: p.attachments ?? [], createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "insurance_claim", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.insuranceClaimCreate }, "Consumer processing failed");
    }
  });

  // GAP2-ASSETS-INSURANCE-CLAIMS-01 + 02: the claim decision (approve/settle/
  // reject) is applied here via the conditional, tenant-scoped UPDATE in
  // repo.updateClaim (which also enqueues the audit in the same tx). The route
  // already preflighted status + SoD + money bounds; the consumer re-asserts
  // them so a stale/duplicate command, or one that raced past the preflight,
  // changes zero rows rather than being silently applied.
  queue.subscribe(COMMANDS.insuranceClaimDecide, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; decision: "approve" | "settle" | "reject";
        settlementAmountMinor?: number; reason?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const claim = await repo.findClaimByIdTx(tx, p.id, p.tenantId);
        if (!claim) {
          log.warn({ messageId: msg.messageId, id: p.id }, "claim decide skipped: claim not found");
          return;
        }
        // Defence in depth: re-assert maker-checker inside the write tx.
        if (claim.createdBy === msg.actorId) {
          log.warn({ messageId: msg.messageId, id: p.id }, "claim decide refused: self-approval (SoD)");
          return;
        }
        if (claim.status !== "pending" && claim.status !== "approved") {
          log.warn({ messageId: msg.messageId, id: p.id, status: claim.status }, "claim decide skipped: not decidable");
          return;
        }
        const base: Partial<repo.ClaimInsertT> = { updatedAt: new Date(), updatedBy: msg.actorId };
        const auditBefore = { status: claim.status, amountMinor: claim.settledAmountMinor };
        if (p.decision === "approve") {
          await repo.updateClaimTx(tx, p.tenantId, p.id, { ...base, status: "approved" }, DECIDABLE,
            auditFor(msg, "approve", "insurance_claim", auditBefore));
        } else if (p.decision === "settle") {
          const settlement = BigInt(p.settlementAmountMinor ?? 0);
          // Money-safety re-assert: a settlement can never exceed what was claimed.
          if (settlement > BigInt(claim.claimAmountMinor)) {
            log.warn({ messageId: msg.messageId, id: p.id }, "claim settle refused: settlement exceeds claim");
            return;
          }
          await repo.updateClaimTx(tx, p.tenantId, p.id,
            { ...base, status: "settled", settledAmountMinor: settlement }, DECIDABLE,
            auditFor(msg, "settle", "insurance_claim", auditBefore));
        } else {
          const reason = p.reason ?? "";
          await repo.updateClaimTx(tx, p.tenantId, p.id, { ...base, status: "rejected" }, DECIDABLE,
            auditFor(msg, "reject", "insurance_claim", auditBefore, reason), `Rejected: ${reason}`);
        }
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.insuranceClaimDecide }, "Consumer processing failed");
    }
  });

  // GAP2-ASSETS-INSURANCE-CLAIMS-02: policy update applied on the consumer path.
  queue.subscribe(COMMANDS.insurancePolicyUpdate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; status?: string; endDate?: string; premiumMinor?: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const existing = await repo.findPolicyByIdTx(tx, p.id, p.tenantId);
        if (!existing) {
          log.warn({ messageId: msg.messageId, id: p.id }, "policy update skipped: policy not found");
          return;
        }
        const patch: Partial<repo.PolicyInsertT> = { updatedAt: new Date(), updatedBy: msg.actorId };
        if (p.status !== undefined) patch.status = p.status;
        if (p.endDate !== undefined) patch.endDate = p.endDate;
        if (p.premiumMinor !== undefined) patch.premiumMinor = BigInt(p.premiumMinor);
        await repo.updatePolicyTx(tx, p.tenantId, p.id, patch,
          auditFor(msg, "update", "insurance_policy", { status: existing.status, amountMinor: existing.premiumMinor }));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.insurancePolicyUpdate }, "Consumer processing failed");
    }
  });
}

const DECIDABLE: string[] = ["pending", "approved"];

function auditFor(
  msg: { actorId: string; correlationId: string },
  action: string,
  resourceType: "insurance_claim" | "insurance_policy",
  before: { status: string; amountMinor: bigint },
  reason?: string,
): repo.DecisionAudit {
  return { actorId: msg.actorId, correlationId: msg.correlationId, action, resourceType, before, ...(reason !== undefined ? { reason } : {}) };
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
