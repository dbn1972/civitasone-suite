import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertBudgetSufficient, assertCanDispatch, assertTransitionAllowed, assertDistinctMakerChecker, DomainError } from "./domain.js";
import * as vendorRepo from "../vendor/repo.js";
import * as blacklistRepo from "../vendor-blacklist/repo.js";
import { allocateDocNo } from "../../shared/numbering.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";
const PO_WORKFLOW_NAME = "Procurement PO Approval";
const FINANCE_URL = process.env.FINANCE_SERVICE_URL ?? "http://localhost:3007";
// Internal service-to-service secret. finance-service's resolveServiceContext
// rejects an x-internal call (401 UNAUTHENTICATED) unless x-service-secret
// matches this AND x-tenant-id is present. Injected via ecosystem env.
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

/** Finance service unreachable / errored — distinct from a budget shortfall. */
class FinanceUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "FinanceUnavailableError"; }
}

// PO value above this (Rs 1,000 in paise) must carry a sanctionRef (#14).
const SANCTION_REQUIRED_ABOVE_MINOR = 100000n;

async function checkSanctionAvailable(sanctionRef: string, required: bigint, tenantId: string): Promise<void> {
  const sanctionId = sanctionRef.replace(/^.*:/, "");
  let res: Response;
  try {
    res = await fetch(`${FINANCE_URL}/v1/finance/sanctions/${sanctionId}/available`, {
      // finance-call header fix: an internal call MUST carry x-internal +
      // x-service-secret + x-tenant-id or finance returns 401 (and never posts
      // under the wrong tenant). x-tenant-id scopes the sanction lookup.
      headers: {
        "x-internal": "1",
        "x-service-secret": INTERNAL_SERVICE_SECRET,
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // Network error / timeout → retryable finance-unavailable, NOT budget-exceeded.
    throw new FinanceUnavailableError(`finance-service unreachable: ${String(err)}`);
  }
  if (!res.ok) throw new FinanceUnavailableError(`finance-service sanctions check failed: ${res.status}`);
  const data = await res.json() as { available: string };
  // Throws DomainError("BUDGET_EXCEEDED") only when funds are genuinely insufficient.
  assertBudgetSufficient(BigInt(data.available), required);
}

export function registerPoConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.poCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; poNo: string; vendorId: string; indentRef: string;
      sanctionRef?: string; rateContractRef?: string; deliveryDate?: string;
      items: Array<{ itemCode: string; description: string; quantity: number; unit: string; unitPriceMinor: number; itemType?: string }>;
    };
    const totalMinor = p.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);

    // #14: non-trivial PO value MUST carry a sanctionRef. Missing → reject (not a
    // budget shortfall) and do not write a PO.
    if (!p.sanctionRef && totalMinor > SANCTION_REQUIRED_ABOVE_MINOR) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.poBudgetExceeded, eventType: EVENTS.poBudgetExceeded,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { poId: p.id, poNo: p.poNo, totalMinor: totalMinor.toString(), reason: "SANCTION_REF_REQUIRED", code: "SANCTION_REF_REQUIRED" },
        });
        await audit(tx, msg, "rejected_no_sanction", "po", p.id);
      });
      return;
    }

    // Budget check: call finance-service BEFORE any DB write (no DB call inside txn)
    if (p.sanctionRef) {
      try {
        await checkSanctionAvailable(p.sanctionRef, totalMinor, p.tenantId);
      } catch (err) {
        if (err instanceof FinanceUnavailableError) {
          // #14: finance unreachable is RETRYABLE — rethrow so the queue redelivers.
          // Do NOT misreport this as a budget shortfall and do NOT write a PO.
          throw err;
        }
        // Genuine budget shortfall (DomainError BUDGET_EXCEEDED) → emit + drop PO.
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await enqueue(tx, {
            topic: EVENTS.poBudgetExceeded, eventType: EVENTS.poBudgetExceeded,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { poId: p.id, poNo: p.poNo, sanctionRef: p.sanctionRef, totalMinor: totalMinor.toString(), reason: String(err), code: "BUDGET_EXCEEDED" },
          });
          await audit(tx, msg, "rejected_budget_exceeded", "po", p.id);
        });
        return;
      }
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Blacklist gate re-checked INSIDE the txn against the persisted store
      // (tenant-scoped). Reject the PO for a blacklisted vendor — no PO written.
      const vendorTx = await vendorRepo.findVendorByIdTx(tx, p.vendorId, p.tenantId);
      const blacklisted =
        (await blacklistRepo.isBlacklistedTx(tx, p.tenantId, p.vendorId)) ||
        (vendorTx?.vendorType === "blacklisted");
      if (blacklisted) {
        await enqueue(tx, {
          topic: EVENTS.poVendorBlacklisted, eventType: EVENTS.poVendorBlacklisted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            poId: p.id, poNo: p.poNo, vendorId: p.vendorId,
            reason: vendorTx?.blacklistReason ?? "vendor is blacklisted (CVC order)",
          },
        });
        await audit(tx, msg, "rejected_blacklisted", "po", p.id);
        return;
      }

      // Gapless server-generated PO number (#12) — allocated only after the
      // blacklist gate passes, so a rejected PO never consumes a number.
      const poNo = await allocateDocNo(tx, p.tenantId, "po");
      await repo.insertPo(tx, {
        id: p.id, tenantId: p.tenantId, poNo, vendorId: p.vendorId,
        indentRef: p.indentRef, sanctionRef: p.sanctionRef ?? null,
        rateContractRef: p.rateContractRef ?? null, gemOrderNo: null,
        totalMinor, currency: "INR", status: "draft",
        deliveryDate: p.deliveryDate ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows = p.items.map((i) => ({
        id: randomUUID(), poId: p.id, tenantId: p.tenantId,
        itemCode: i.itemCode, description: i.description, quantity: i.quantity,
        unit: i.unit, unitPriceMinor: BigInt(i.unitPriceMinor), currency: "INR" as const,
        itemType: i.itemType ?? "consumable",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertPoItems(tx, itemRows);
      const wfId = randomUUID();
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: wfId,
          tenantId: msg.tenantId,
          name: `${PO_WORKFLOW_NAME} — ${poNo}`,
          status: "active",
          definitionCode: "procurement_po_approval",
          initialTaskName: "Procurement Head Approval",
          version: 1,
          refType: "procurement_po",
          refId: p.id,
        },
      });
      await audit(tx, msg, "create", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });

  queue.subscribe(COMMANDS.poApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const po = await repo.findPoByIdTx(tx, p.id, p.tenantId);
      if (!po) throw new Error(`po ${p.id} not found`);
      // SoD (#9): the approver must differ from the PO creator. Self-approval is
      // rejected — emit a rejection event instead of approving.
      try {
        assertDistinctMakerChecker(po.createdBy, msg.actorId);
      } catch (err) {
        if (err instanceof DomainError && err.code === "SOD_VIOLATION") {
          await enqueue(tx, {
            topic: EVENTS.poApprovalRejected, eventType: EVENTS.poApprovalRejected,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { poId: p.id, poNo: po.poNo, reason: err.message, code: err.code },
          });
          await audit(tx, msg, "approval_rejected_sod", "po", p.id);
          return;
        }
        throw err;
      }
      assertTransitionAllowed(po.status ?? "draft", "approved");
      await repo.updatePoVersioned(tx, p.id, po.version ?? 1, { status: "approved", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.poApproved, eventType: EVENTS.poApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { poId: p.id, poNo: po.poNo, vendorId: po.vendorId, totalMinor: String(po.totalMinor) },
      });
      await audit(tx, msg, "approve", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });

  queue.subscribe(COMMANDS.poDispatch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const po = await repo.findPoByIdTx(tx, p.id, p.tenantId);
      if (!po) throw new Error(`po ${p.id} not found`);
      assertCanDispatch(po.status ?? "draft");
      await repo.updatePoVersioned(tx, p.id, po.version ?? 1, { status: "dispatched", updatedBy: msg.actorId });
      await audit(tx, msg, "dispatch", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });

  queue.subscribe(COMMANDS.gemOrderCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; poNo: string; vendorId: string; indentRef: string;
      sanctionRef?: string; gemOrderNo: string; deliveryDate?: string;
      items: Array<{ itemCode: string; description: string; quantity: number; unit: string; unitPriceMinor: number; itemType?: string }>;
    };
    const totalMinor = p.items.reduce((s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Blacklist gate (#3/#4/#5): reject GeM award for a blacklisted vendor.
      const vendorTx = await vendorRepo.findVendorByIdTx(tx, p.vendorId, p.tenantId);
      const blacklisted =
        (await blacklistRepo.isBlacklistedTx(tx, p.tenantId, p.vendorId)) ||
        (vendorTx?.vendorType === "blacklisted");
      if (blacklisted) {
        await enqueue(tx, {
          topic: EVENTS.poVendorBlacklisted, eventType: EVENTS.poVendorBlacklisted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            poId: p.id, poNo: p.poNo, vendorId: p.vendorId,
            reason: vendorTx?.blacklistReason ?? "vendor is blacklisted (CVC order)",
          },
        });
        await audit(tx, msg, "rejected_blacklisted", "po", p.id);
        return;
      }

      const poNo = await allocateDocNo(tx, p.tenantId, "po");
      await repo.insertPo(tx, {
        id: p.id, tenantId: p.tenantId, poNo, vendorId: p.vendorId,
        indentRef: p.indentRef, sanctionRef: p.sanctionRef ?? null, rateContractRef: null,
        gemOrderNo: p.gemOrderNo, totalMinor, currency: "INR", status: "gem_placed",
        deliveryDate: p.deliveryDate ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows = p.items.map((i) => ({
        id: randomUUID(), poId: p.id, tenantId: p.tenantId,
        itemCode: i.itemCode, description: i.description, quantity: i.quantity,
        unit: i.unit, unitPriceMinor: BigInt(i.unitPriceMinor), currency: "INR" as const,
        itemType: i.itemType ?? "consumable",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertPoItems(tx, itemRows);
      await audit(tx, msg, "gem_order", "po", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "po", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
