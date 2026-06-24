import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeEffectivePrice, rankBids } from "./domain.js";
import * as vendorRepo from "../vendor/repo.js";
import * as blacklistRepo from "../vendor-blacklist/repo.js";
import { allocateDocNo } from "../../shared/numbering.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerAuctionConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.auctionCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; auctionNo: string; indentRef: string; title: string;
      reserveMinor: number; startAt: string; endAt: string; msePreference: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const auctionNo = await allocateDocNo(tx, p.tenantId, "auction");
      await repo.insertAuction(tx, {
        id: p.id, tenantId: p.tenantId, auctionNo, indentRef: p.indentRef,
        title: p.title, reserveMinor: BigInt(p.reserveMinor), currency: "INR",
        startAt: new Date(p.startAt), endAt: new Date(p.endAt),
        status: "active", winningBidId: null, msePreference: p.msePreference,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "auction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "auction", p.id));
  });

  queue.subscribe(COMMANDS.bidSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; auctionId: string; tenantId: string; vendorId: string;
      bidMinor: number; isMse: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const auction = await repo.findAuctionByIdTx(tx, p.auctionId);
      if (!auction) throw new Error(`auction ${p.auctionId} not found`);
      const effectiveMinor = computeEffectivePrice(BigInt(p.bidMinor), p.isMse, auction.msePreference ?? true);
      await repo.insertBid(tx, {
        id: p.id, auctionId: p.auctionId, tenantId: p.tenantId,
        vendorId: p.vendorId, bidMinor: BigInt(p.bidMinor), currency: "INR",
        isMse: p.isMse, effectiveMinor, rank: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "bid", "auction", p.auctionId);
    });
  });

  queue.subscribe(COMMANDS.auctionClose, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const auction = await repo.findAuctionByIdTx(tx, p.id);
      if (!auction) throw new Error(`auction ${p.id} not found`);
      const bids = await repo.findBidsByAuctionTx(tx, p.id);

      // Eligibility (#11): exclude blacklisted / disqualified vendors before ranking.
      const eligibility = new Map<string, boolean>();
      for (const vid of new Set(bids.map((b) => b.vendorId))) {
        const blacklisted = await blacklistRepo.isBlacklistedTx(tx, p.tenantId, vid);
        const vendor = await vendorRepo.findVendorByIdTx(tx, vid, p.tenantId);
        const eligible = !blacklisted && vendor != null && vendor.vendorType !== "blacklisted";
        eligibility.set(vid, eligible);
      }

      const ranked = rankBids(
        bids.map((b) => ({
          id: b.id, vendorId: b.vendorId, bidMinor: b.bidMinor, isMse: b.isMse,
          bidAt: b.bidAt, eligible: eligibility.get(b.vendorId) ?? false,
        })),
        auction.msePreference ?? true
      );
      // Clear rank on every bid first, then set rank on eligible/ranked ones.
      for (const b of bids) {
        await repo.updateBid(tx, b.id, { rank: null });
      }
      for (const rb of ranked) {
        await repo.updateBid(tx, rb.id, { effectiveMinor: rb.effectiveMinor, rank: rb.rank });
      }
      const winner = ranked[0];
      await repo.updateAuctionVersioned(tx, p.id, auction.version ?? 1, {
        status: "closed", winningBidId: winner?.id ?? null,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.auctionClosed, eventType: EVENTS.auctionClosed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { auctionId: p.id, winnerVendorId: winner?.vendorId ?? null, winnerBidMinor: winner?.bidMinor.toString() ?? null },
      });
      await audit(tx, msg, "close", "auction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "auction", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
