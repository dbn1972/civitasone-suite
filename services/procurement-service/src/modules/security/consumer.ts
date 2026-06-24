import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, FINANCE_GL_POST } from "../../topics.js";
import { allocateDocNo } from "../../shared/numbering.js";
import * as repo from "./repo.js";
import { assertEmdTransition, assertPbgTransition, assertPositiveAmount } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * H4: build a BALANCED, idempotency-keyed GL post payload.
 *
 * - `idempotencyKey` is deterministic per disposition (e.g. `emd:{id}:forfeited`,
 *   `pbg:{id}:released`) so a relay re-publish is deduped downstream by key and
 *   cannot double-post.
 * - `legs` carries BOTH sides with EQUAL amounts (debit total == credit total),
 *   making the contract balanced/self-checking. `debit`/`credit`/`amountMinor`
 *   are retained for backward compatibility with the existing finance consumer.
 *
 * Account map (paise, all single debit + single credit, equal amounts):
 *   emd_collected  : DR bank                     CR emd_deposit_liability
 *   emd_forfeited  : DR emd_deposit_liability    CR forfeiture_income
 *   emd_refunded   : DR emd_deposit_liability    CR bank
 *   pbg_collected  : DR bank                     CR pbg_deposit_liability
 *   pbg_forfeited  : DR pbg_deposit_liability    CR forfeiture_income
 *   pbg_released   : DR pbg_deposit_liability    CR bank
 */
function glPost(args: {
  type: string; refType: string; refId: string; idempotencyKey: string;
  amountMinor: string; debit: string; credit: string;
}): Record<string, unknown> {
  return {
    source: "procurement", type: args.type, refType: args.refType, refId: args.refId,
    idempotencyKey: args.idempotencyKey,
    amountMinor: args.amountMinor, currency: "INR",
    debit: args.debit, credit: args.credit,
    legs: [
      { account: args.debit, side: "debit", amountMinor: args.amountMinor, currency: "INR" },
      { account: args.credit, side: "credit", amountMinor: args.amountMinor, currency: "INR" },
    ],
  };
}

export function registerSecurityConsumers(queue: Queue): void {
  // ── EMD ────────────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.emdCollect, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; vendorId: string; tenderId?: string; bidId?: string;
      amountMinor: number; instrument: string;
    };
    assertPositiveAmount(BigInt(p.amountMinor));
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const emdNo = await allocateDocNo(tx, p.tenantId, "emd");
      await repo.insertEmd(tx, {
        id: p.id, tenantId: p.tenantId, emdNo, vendorId: p.vendorId,
        tenderId: p.tenderId ?? null, bidId: p.bidId ?? null,
        amountMinor: BigInt(p.amountMinor), currency: "INR",
        instrument: p.instrument, status: "collected",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // Finance: EMD received → liability (deposit held). Paise as strings.
      await enqueue(tx, {
        topic: FINANCE_GL_POST, eventType: FINANCE_GL_POST,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: glPost({
          type: "emd_collected", refType: "emd", refId: p.id,
          idempotencyKey: `emd:${p.id}:collected`,
          amountMinor: String(p.amountMinor), debit: "bank", credit: "emd_deposit_liability",
        }),
      });
      await enqueue(tx, {
        topic: EVENTS.emdCollected, eventType: EVENTS.emdCollected,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { emdId: p.id, emdNo, vendorId: p.vendorId, amountMinor: String(p.amountMinor) },
      });
      await audit(tx, msg, "collect", "emd", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "emd", p.id));
  });

  queue.subscribe(COMMANDS.emdForfeit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const emd = await repo.findEmdByIdTx(tx, p.id, p.tenantId);
      if (!emd) throw new Error(`emd ${p.id} not found`);
      assertEmdTransition(emd.status, "forfeited");
      await repo.updateEmdVersioned(tx, p.id, emd.version, {
        status: "forfeited", forfeitReason: p.reason ?? null, resolvedAt: new Date(), updatedBy: msg.actorId,
      });
      // Finance: forfeiture → liability becomes income.
      await enqueue(tx, {
        topic: FINANCE_GL_POST, eventType: FINANCE_GL_POST,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: glPost({
          type: "emd_forfeited", refType: "emd", refId: p.id,
          idempotencyKey: `emd:${p.id}:forfeited`,
          amountMinor: String(emd.amountMinor), debit: "emd_deposit_liability", credit: "forfeiture_income",
        }),
      });
      await enqueue(tx, {
        topic: EVENTS.emdForfeited, eventType: EVENTS.emdForfeited,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { emdId: p.id, vendorId: emd.vendorId, amountMinor: String(emd.amountMinor), reason: p.reason ?? null },
      });
      await audit(tx, msg, "forfeit", "emd", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "emd", p.id));
  });

  queue.subscribe(COMMANDS.emdRefund, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const emd = await repo.findEmdByIdTx(tx, p.id, p.tenantId);
      if (!emd) throw new Error(`emd ${p.id} not found`);
      assertEmdTransition(emd.status, "refunded");
      await repo.updateEmdVersioned(tx, p.id, emd.version, {
        status: "refunded", resolvedAt: new Date(), updatedBy: msg.actorId,
      });
      // Finance: refund → reverse the deposit liability against bank.
      await enqueue(tx, {
        topic: FINANCE_GL_POST, eventType: FINANCE_GL_POST,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: glPost({
          type: "emd_refunded", refType: "emd", refId: p.id,
          idempotencyKey: `emd:${p.id}:refunded`,
          amountMinor: String(emd.amountMinor), debit: "emd_deposit_liability", credit: "bank",
        }),
      });
      await enqueue(tx, {
        topic: EVENTS.emdRefunded, eventType: EVENTS.emdRefunded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { emdId: p.id, vendorId: emd.vendorId, amountMinor: String(emd.amountMinor) },
      });
      await audit(tx, msg, "refund", "emd", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "emd", p.id));
  });

  // ── PBG (performance security) ──────────────────────────────────────────────
  queue.subscribe(COMMANDS.pbgCollect, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; vendorId: string; poRef?: string; tenderId?: string;
      amountMinor: number; instrument: string; validUntil?: string;
    };
    assertPositiveAmount(BigInt(p.amountMinor));
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pbgNo = await allocateDocNo(tx, p.tenantId, "pbg");
      await repo.insertPbg(tx, {
        id: p.id, tenantId: p.tenantId, pbgNo, vendorId: p.vendorId,
        poRef: p.poRef ?? null, tenderId: p.tenderId ?? null,
        amountMinor: BigInt(p.amountMinor), currency: "INR",
        instrument: p.instrument, validUntil: p.validUntil ?? null, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: FINANCE_GL_POST, eventType: FINANCE_GL_POST,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: glPost({
          type: "pbg_collected", refType: "pbg", refId: p.id,
          idempotencyKey: `pbg:${p.id}:collected`,
          amountMinor: String(p.amountMinor), debit: "bank", credit: "pbg_deposit_liability",
        }),
      });
      await enqueue(tx, {
        topic: EVENTS.pbgCollected, eventType: EVENTS.pbgCollected,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { pbgId: p.id, pbgNo, vendorId: p.vendorId, amountMinor: String(p.amountMinor) },
      });
      await audit(tx, msg, "collect", "pbg", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pbg", p.id));
  });

  queue.subscribe(COMMANDS.pbgForfeit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pbg = await repo.findPbgByIdTx(tx, p.id, p.tenantId);
      if (!pbg) throw new Error(`pbg ${p.id} not found`);
      assertPbgTransition(pbg.status, "forfeited");
      await repo.updatePbgVersioned(tx, p.id, pbg.version, {
        status: "forfeited", forfeitReason: p.reason ?? null, resolvedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: FINANCE_GL_POST, eventType: FINANCE_GL_POST,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: glPost({
          type: "pbg_forfeited", refType: "pbg", refId: p.id,
          idempotencyKey: `pbg:${p.id}:forfeited`,
          amountMinor: String(pbg.amountMinor), debit: "pbg_deposit_liability", credit: "forfeiture_income",
        }),
      });
      await enqueue(tx, {
        topic: EVENTS.pbgForfeited, eventType: EVENTS.pbgForfeited,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { pbgId: p.id, vendorId: pbg.vendorId, amountMinor: String(pbg.amountMinor), reason: p.reason ?? null },
      });
      await audit(tx, msg, "forfeit", "pbg", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pbg", p.id));
  });

  queue.subscribe(COMMANDS.pbgRelease, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pbg = await repo.findPbgByIdTx(tx, p.id, p.tenantId);
      if (!pbg) throw new Error(`pbg ${p.id} not found`);
      assertPbgTransition(pbg.status, "released");
      await repo.updatePbgVersioned(tx, p.id, pbg.version, {
        status: "released", resolvedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: FINANCE_GL_POST, eventType: FINANCE_GL_POST,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: glPost({
          type: "pbg_released", refType: "pbg", refId: p.id,
          idempotencyKey: `pbg:${p.id}:released`,
          amountMinor: String(pbg.amountMinor), debit: "pbg_deposit_liability", credit: "bank",
        }),
      });
      await enqueue(tx, {
        topic: EVENTS.pbgReleased, eventType: EVENTS.pbgReleased,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { pbgId: p.id, vendorId: pbg.vendorId, amountMinor: String(pbg.amountMinor) },
      });
      await audit(tx, msg, "release", "pbg", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pbg", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
