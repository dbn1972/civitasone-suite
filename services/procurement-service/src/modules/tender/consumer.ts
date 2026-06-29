import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { allocateDocNo } from "../../shared/numbering.js";
import { minorString } from "@civitasone/schemas/money";
import * as repo from "./repo.js";
import {
  assertTenderTransition, assertCanOpenFinancial, determineL1,
  assertDistinctMakerChecker, assertTechEvaluatorDistinct, DomainError,
} from "./domain.js";
import * as vendorRepo from "../vendor/repo.js";
import * as blacklistRepo from "../vendor-blacklist/repo.js";

const AUDIT_TOPIC = "audit.event.record";
// C2: award value above this (Rs 1,000 in paise) must carry a sanctionRef,
// matching po/consumer's SANCTION_REQUIRED_ABOVE_MINOR gate.
const SANCTION_REQUIRED_ABOVE_MINOR = 100000n;

export function registerTenderConsumers(queue: Queue): void {
  // 1. Create tender (draft)
  queue.subscribe(COMMANDS.tenderCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; title: string; scope?: string; eligibility?: string;
      type: string; estimatedMinor: number; emdAmountMinor: number; bidClosingDate: string;
      sanctionRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const tenderNo = await allocateDocNo(tx, p.tenantId, "tender");
      await repo.insertTender(tx, {
        id: p.id, tenantId: p.tenantId, tenderNo, title: p.title,
        scope: p.scope ?? null, eligibility: p.eligibility ?? null,
        type: p.type, estimatedMinor: BigInt(p.estimatedMinor),
        emdAmountMinor: BigInt(p.emdAmountMinor), currency: "INR",
        bidClosingDate: p.bidClosingDate, status: "draft",
        sanctionRef: p.sanctionRef ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "tender", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.id));
  });

  // 2. Publish NIT
  queue.subscribe(COMMANDS.tenderPublish, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = await repo.findTenderByIdTx(tx, p.id, p.tenantId);
      if (!t) throw new Error(`tender ${p.id} not found`);
      assertTenderTransition(t.status, "published");
      const nitRef = `NIT:${t.tenderNo}`;
      await repo.updateTenderVersioned(tx, p.id, t.version, {
        status: "published", nitRef, publishDate: new Date().toISOString().slice(0, 10),
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.tenderPublished, eventType: EVENTS.tenderPublished,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { tenderId: p.id, tenderNo: t.tenderNo, nitRef },
      });
      await audit(tx, msg, "publish", "tender", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.id));
  });

  // 3. Bid submission — TWO sealed envelopes (technical row + sealed financial row)
  queue.subscribe(COMMANDS.tenderBidSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenderId: string; tenantId: string; vendorId: string; vendorName?: string;
      technicalScore?: number; financialAmountMinor: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = await repo.findTenderByIdTx(tx, p.tenderId, p.tenantId);
      if (!t) throw new NonRetryableError(`tender ${p.tenderId} not found`);
      if (t.status !== "published") {
        throw new NonRetryableError(`[BIDDING_CLOSED] bids accepted only while tender is 'published' (is '${t.status}')`);
      }
      // H2: reject late bids — the closing date is the last full day bids are
      // accepted; anything after end-of-day on bidClosingDate is rejected.
      // bidClosingDate is a DATE column ('YYYY-MM-DD'); compare against now (UTC).
      if (t.bidClosingDate) {
        const closeMs = Date.parse(`${t.bidClosingDate}T23:59:59.999Z`);
        if (Number.isFinite(closeMs) && Date.now() > closeMs) {
          throw new NonRetryableError(`[BIDDING_CLOSED] bid closing date ${t.bidClosingDate} has passed`);
        }
      }
      // H3: one sealed bid per (tenant, tender, vendor). Friendly in-txn check in
      // addition to the UNIQUE index (uq_tender_bids_tenant_tender_vendor).
      const existing = await repo.findBidsByTenderTx(tx, p.tenderId, p.tenantId);
      if (existing.some((b) => b.vendorId === p.vendorId)) {
        throw new NonRetryableError(`[DUPLICATE_BID] vendor ${p.vendorId} has already submitted a bid for this tender`);
      }
      const bidNo = await allocateDocNo(tx, p.tenantId, "bid");
      // Technical envelope row — NO financial value stored here.
      await repo.insertBid(tx, {
        id: p.id, tenderId: p.tenderId, tenantId: p.tenantId, vendorId: p.vendorId,
        vendorName: p.vendorName ?? "", bidNo, bidAmount: 0n, currency: "INR",
        technicalScore: p.technicalScore ?? null, technicalQualified: null,
        financialOpened: false, status: "submitted",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // SEALED financial envelope — separate table, sealed=true.
      await repo.insertFinancialBid(tx, {
        bidId: p.id, tenderId: p.tenderId, tenantId: p.tenantId, vendorId: p.vendorId,
        amountMinor: BigInt(p.financialAmountMinor), currency: "INR", sealed: true,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "bid_submit", "tender", p.tenderId);
    });
  });

  // 4. Technical evaluation / qualification. Moves tender published → technical_evaluation.
  queue.subscribe(COMMANDS.tenderTechEvaluate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      results: Array<{ bidId: string; qualified: boolean; score?: number; notes?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = await repo.findTenderByIdTx(tx, p.id, p.tenantId);
      if (!t) throw new Error(`tender ${p.id} not found`);
      // C1: persist the technical evaluator so award-stage SoD can reject when
      // the award approver == technical evaluator.
      if (t.status === "published") {
        assertTenderTransition(t.status, "technical_evaluation");
        await repo.updateTenderVersioned(tx, p.id, t.version, {
          status: "technical_evaluation", techEvaluatedBy: msg.actorId, updatedBy: msg.actorId,
        });
      } else if (t.status === "technical_evaluation") {
        await repo.updateTenderVersioned(tx, p.id, t.version, {
          techEvaluatedBy: msg.actorId, updatedBy: msg.actorId,
        });
      } else {
        throw new DomainError("INVALID_TRANSITION", `technical evaluation requires 'published'/'technical_evaluation' (is '${t.status}')`);
      }
      for (const r of p.results) {
        const bid = await repo.findBidByIdTx(tx, r.bidId, p.tenantId);
        if (!bid || bid.tenderId !== p.id) continue;
        await repo.updateBidVersioned(tx, r.bidId, bid.version, {
          technicalQualified: r.qualified,
          technicalScore: r.score ?? bid.technicalScore,
          qualificationNotes: r.notes ?? null,
          status: r.qualified ? "technically_qualified" : "technically_rejected",
          updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.tenderTechEvaluated, eventType: EVENTS.tenderTechEvaluated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { tenderId: p.id, qualified: p.results.filter((r) => r.qualified).map((r) => r.bidId) },
      });
      await audit(tx, msg, "tech_evaluate", "tender", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.id));
  });

  // 5. Open financial envelopes — ONLY for technically-qualified bids.
  queue.subscribe(COMMANDS.tenderFinancialOpen, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = await repo.findTenderByIdTx(tx, p.id, p.tenantId);
      if (!t) throw new Error(`tender ${p.id} not found`);
      // published is not allowed; must have gone through technical_evaluation.
      if (t.status === "technical_evaluation") {
        assertTenderTransition(t.status, "financial_evaluation");
        await repo.updateTenderVersioned(tx, p.id, t.version, { status: "financial_evaluation", updatedBy: msg.actorId });
      } else if (t.status !== "financial_evaluation") {
        throw new DomainError("INVALID_TRANSITION", `financial open requires 'technical_evaluation'/'financial_evaluation' (is '${t.status}')`);
      }
      const bids = await repo.findBidsByTenderTx(tx, p.id, p.tenantId);
      let opened = 0;
      for (const bid of bids) {
        // Read guard at write time too: only qualified bids' envelopes open.
        if (bid.technicalQualified !== true) continue;
        // Tender already in financial_evaluation here (just set or pre-existing).
        assertCanOpenFinancial("financial_evaluation", bid.technicalQualified);
        const fin = await repo.findFinancialBidByBidIdTx(tx, bid.id, p.tenantId);
        if (!fin || !fin.sealed) continue;
        await repo.openFinancialBidVersioned(tx, bid.id, fin.version, msg.actorId);
        // Surface the now-revealed amount onto the technical bid row for reporting.
        await repo.updateBidVersioned(tx, bid.id, bid.version, {
          bidAmount: fin.amountMinor, financialOpened: true, status: "financial_opened",
          updatedBy: msg.actorId,
        });
        opened++;
      }
      await enqueue(tx, {
        topic: EVENTS.tenderFinancialOpened, eventType: EVENTS.tenderFinancialOpened,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { tenderId: p.id, openedCount: opened },
      });
      await audit(tx, msg, "financial_open", "tender", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.id));
  });

  // 6. Award — L1 over qualified, non-blacklisted bidders → emit PO create.
  queue.subscribe(COMMANDS.tenderAward, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; sanctionRef?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = await repo.findTenderByIdTx(tx, p.id, p.tenantId);
      if (!t) throw new Error(`tender ${p.id} not found`);
      assertTenderTransition(t.status, "awarded");

      // C1: Segregation of duties across the tender lifecycle. The award approver
      // (this actor) must differ from the tender creator AND the technical
      // evaluator. Mirrors po/consumer's assertDistinctMakerChecker; throws
      // DomainError SOD_VIOLATION inside the txn so the award is NOT recorded.
      assertDistinctMakerChecker(t.createdBy, msg.actorId);
      if (t.techEvaluatedBy) assertTechEvaluatorDistinct(t.techEvaluatedBy, msg.actorId);

      const bids = await repo.findBidsByTenderTx(tx, p.id, p.tenantId);
      const fins = await repo.findFinancialBidsByTenderTx(tx, p.id, p.tenantId);
      const finByBid = new Map(fins.map((f) => [f.bidId, f]));

      // Eligibility: not blacklisted / not disqualified vendor.
      const eligibility = new Map<string, boolean>();
      for (const vid of new Set(bids.map((b) => b.vendorId))) {
        const blacklisted = await blacklistRepo.isBlacklistedTx(tx, p.tenantId, vid);
        const vendor = await vendorRepo.findVendorByIdTx(tx, vid, p.tenantId);
        eligibility.set(vid, !blacklisted && vendor != null && vendor.vendorType !== "blacklisted");
      }

      const candidates = bids.map((b) => {
        const fin = finByBid.get(b.id);
        return {
          bidId: b.id, vendorId: b.vendorId,
          amountMinor: fin?.amountMinor ?? 0n,
          // qualified = technically qualified AND envelope opened (revealed).
          qualified: b.technicalQualified === true && fin != null && fin.sealed === false,
          eligible: eligibility.get(b.vendorId) ?? false,
          submittedAt: b.createdAt,
        };
      });
      const ranked = determineL1(candidates);

      const winner = ranked[0];
      if (!winner) {
        throw new DomainError("NO_QUALIFIED_BIDDER", "no qualified, non-blacklisted bidder with an opened financial envelope");
      }

      // C2: high-value award MUST carry a sanctionRef (tender-level, set at create
      // or supplied at award). Without it the PO consumer would reject the
      // resulting poCreate (SANCTION_REQUIRED) while the tender is already marked
      // awarded → permanent divergence. Fail the award in-txn instead.
      const sanctionRef = p.sanctionRef ?? t.sanctionRef ?? null;
      if (!sanctionRef && winner.amountMinor > SANCTION_REQUIRED_ABOVE_MINOR) {
        throw new DomainError(
          "SANCTION_REQUIRED",
          `award value ${winner.amountMinor} paise (> Rs 1,000) requires a sanctionRef; tender stays pre-award`,
        );
      }

      // M3: single-pass rank keyed off freshly-read bid versions. determineL1
      // only returns ranked (qualified+eligible) bids; bids not in `ranked` keep
      // whatever rank they had (none, by construction in this lifecycle).
      const verByBid = new Map(bids.map((b) => [b.id, b.version]));
      for (const r of ranked) {
        await repo.updateBidVersioned(tx, r.bidId, verByBid.get(r.bidId) ?? 1, {
          rank: r.rank, isL1: r.rank === 1,
          status: r.rank === 1 ? "awarded" : "evaluated",
          updatedBy: msg.actorId,
        });
      }

      // C1: record the award approver alongside the award.
      await repo.updateTenderVersioned(tx, p.id, t.version, {
        status: "awarded", awardedBidId: winner.bidId, awardedVendorId: winner.vendorId,
        awardedBy: msg.actorId,
        ...(sanctionRef ? { sanctionRef } : {}),
        updatedBy: msg.actorId,
      });

      // Award → PO: emit po.create command (consumed by PO consumer, gapless PO no).
      // C2: thread the sanctionRef so the PO consumer's sanction gate passes.
      await enqueue(tx, {
        topic: COMMANDS.poCreate, eventType: COMMANDS.poCreate,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: randomUUID(), tenantId: p.tenantId, poNo: "AUTO",
          vendorId: winner.vendorId, indentRef: `tender:${p.id}`,
          ...(sanctionRef ? { sanctionRef } : {}),
          items: [{
            itemCode: t.tenderNo, description: `Award for tender ${t.tenderNo}`,
            quantity: 1, unit: "lot", unitPriceMinor: minorString(winner.amountMinor),
            itemType: "service",
          }],
        },
      });
      await enqueue(tx, {
        topic: EVENTS.tenderAwarded, eventType: EVENTS.tenderAwarded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          tenderId: p.id, tenderNo: t.tenderNo, awardedVendorId: winner.vendorId,
          awardedBidId: winner.bidId, l1AmountMinor: winner.amountMinor.toString(),
        },
      });
      await audit(tx, msg, "award", "tender", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
