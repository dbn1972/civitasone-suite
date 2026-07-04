import type { Queue } from "@civitasone/queue";
import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { minorString } from "@civitasone/schemas/money";
import { assertValidFY, assertReappropriationValid, assertSanctionApproverDistinct, DomainError } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerBudgetConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.budgetCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; headId: string; fy: string; beMinor: number };
    await tenantTransaction(db, p.tenantId, async (tx) => {
      if (!(await markProcessed(tx as Parameters<typeof markProcessed>[0], msg.messageId))) return;
      assertValidFY(p.fy);
      await repo.insertBudget(tx as Parameters<typeof repo.insertBudget>[0], {
        id: p.id, tenantId: p.tenantId, headId: p.headId, fy: p.fy,
        beMinor: BigInt(p.beMinor), reMinor: BigInt(p.beMinor),
        allocatedMinor: 0n, utilisedMinor: 0n, currency: "INR",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "budget", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", `${(msg.payload as any).headId}:${(msg.payload as any).fy}`));
  });

  queue.subscribe(COMMANDS.budgetReappropriate, async (msg) => {
    // Zero-sum re-appropriation (GFR Rule 10): move `amountMinor` paise from the
    // source budget's savings (p.fromBudgetId) to the target budget (p.id).
    const p = msg.payload as { id: string; tenantId: string; fromBudgetId: string; amountMinor: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const source = await repo.findBudgetById(p.fromBudgetId);
      if (!source || source.tenantId !== p.tenantId) {
        throw new DomainError("SOURCE_NOT_FOUND", `re-appropriation source budget ${p.fromBudgetId} not found`);
      }
      const amount = BigInt(p.amountMinor);
      // Validate against the source head's savings before touching any row.
      assertReappropriationValid({ reMinor: source.reMinor, utilisedMinor: source.utilisedMinor }, amount);
      const moved = await repo.transferBudgetReMinorGuarded(tx, p.fromBudgetId, p.id, amount, p.tenantId, msg.actorId);
      if (!moved) {
        throw new DomainError("INSUFFICIENT_SAVINGS", `source budget ${p.fromBudgetId} lacks savings for ${amount} paise`);
      }
      await audit(tx, msg, "re_appropriate", "budget", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", p.id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", p.fromBudgetId));
  });

  queue.subscribe(COMMANDS.sanctionCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; sanctionNo: string; purpose: string; headId: string; amountMinor: number; currency?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // R11 (maker-checker): a sanction is created as `pending_approval`. It does
      // NOT self-approve and does NOT emit sanction.approved here — a separate
      // checker (finance.sanction.approve, SoD-guarded) or the eOffice decision
      // loop moves it to `approved` and emits the event. A single officer can no
      // longer raise an already-sanctioned amount.
      await repo.insertSanction(tx, {
        id: p.id, tenantId: p.tenantId, sanctionNo: p.sanctionNo, purpose: p.purpose,
        headId: p.headId, amountMinor: BigInt(p.amountMinor),
        currency: p.currency ?? "INR", status: "pending_approval",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  queue.subscribe(COMMANDS.sanctionApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sanction = await repo.findSanctionByIdTx(tx, p.id);
      if (!sanction || sanction.tenantId !== p.tenantId) return;
      // Only a pending sanction can be approved (idempotent on redelivery).
      if (sanction.status !== "pending_approval" && sanction.status !== "draft") return;
      // R11 SoD: the approving officer (checker) must differ from the creator
      // (maker). Same-officer approval is the maker-checker bypass we are closing.
      assertSanctionApproverDistinct(sanction.createdBy, msg.actorId);
      await repo.updateSanction(tx, p.id, { status: "approved", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.sanctionApproved, eventType: EVENTS.sanctionApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { sanctionId: p.id, headId: sanction.headId, amountMinor: minorString(sanction.amountMinor) },
      });
      await audit(tx, msg, "approve", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  queue.subscribe(COMMANDS.sanctionReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateSanction(tx, p.id, { status: "cancelled", updatedBy: msg.actorId });
      await audit(tx, msg, "reject", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  queue.subscribe(COMMANDS.sanctionSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sanction = await repo.findSanctionByIdTx(tx, p.id);
      if (!sanction || sanction.tenantId !== p.tenantId) return;
      await repo.updateSanction(tx, p.id, { status: "pending_approval", updatedBy: msg.actorId });
      await audit(tx, msg, "submit_for_eoffice_approval", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  queue.subscribe(COMMANDS.reappropriationSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; fromBudgetId: string; toBudgetId: string; headId?: string; amountMinor: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertReappropriation(tx, {
        id: p.id, tenantId: p.tenantId, budgetId: p.toBudgetId, fromBudgetId: p.fromBudgetId,
        headId: p.headId ?? null,
        amountMinor: BigInt(p.amountMinor), reason: p.reason, status: "pending_approval",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", "reappropriation", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "reappropriation", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
