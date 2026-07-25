import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./scorecard-repo.js";
import {
  computeScorecard, classifyPerformanceEvent, assertShowCauseTransition,
  assertDistinctIssuerDecider, type PerformanceEventType, type PerformanceSource,
} from "./scorecard-domain.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * SVC-049 — vendor performance scorecard consumer.
 *
 * Ingests delivery/quality/SLA signals from GRN and contract domain events (via
 * the outbox/relay) plus manual entries, appends them to the immutable
 * performance-event ledger, then recomputes the vendor's objective scorecard.
 */
export function registerVendorScorecardConsumers(queue: Queue): void {
  // GRN acceptance / rejection → delivery + quality signals.
  for (const topic of [EVENTS.grnAccepted, EVENTS.grnRejected, CONSUMED_EVENTS.contractTerminated]) {
    queue.subscribe(topic, async (msg) => {
      const p = msg.payload as Record<string, unknown>;
      const vendorId = (p.vendorId ?? p.counterpartyId ?? p.partyId) as string | undefined;
      const classified = classifyPerformanceEvent(msg.type ?? topic);
      if (!vendorId || !classified) return; // honest no-op when no vendor to attribute

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await recordAndRecompute(tx, {
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          vendorId, eventType: classified.eventType, source: classified.source,
          sourceRef: (p.grnId ?? p.contractId ?? null) as string | null,
          poRef: (p.poRef ?? null) as string | null,
        });
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "vendor_scorecard", vendorId));
    });
  }

  // Manual / on-demand recompute (also used to ingest a manual perf event).
  queue.subscribe(COMMANDS.vendorScorecardRecompute, async (msg) => {
    const p = msg.payload as {
      vendorId: string; tenantId: string;
      eventType?: PerformanceEventType; source?: PerformanceSource; poRef?: string; sourceRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await recordAndRecompute(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        vendorId: p.vendorId,
        eventType: p.eventType, source: p.source ?? "manual",
        sourceRef: p.sourceRef ?? null, poRef: p.poRef ?? null,
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vendor_scorecard", p.vendorId));
  });

  // ── Show-cause workflow ─────────────────────────────────────────
  queue.subscribe(COMMANDS.vendorShowCauseIssue, async (msg) => {
    const p = msg.payload as { id: string; vendorId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertShowCause(tx, {
        id: p.id, tenantId: p.tenantId, vendorId: p.vendorId, reason: p.reason,
        status: "issued", issuedBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.vendorShowCauseIssued, eventType: EVENTS.vendorShowCauseIssued,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { showCauseId: p.id, vendorId: p.vendorId, tenantId: p.tenantId },
      });
      await audit(tx, msg, "issue", "vendor_show_cause", p.id);
    });
  });

  queue.subscribe(COMMANDS.vendorShowCauseRespond, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; response: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sc = await repo.findShowCauseByIdTx(tx, p.id, p.tenantId);
      if (!sc) throw new Error(`show-cause ${p.id} not found`);
      assertShowCauseTransition(sc.status, "responded");
      await repo.updateShowCause(tx, p.id, {
        status: "responded", response: p.response, respondedAt: new Date(),
        updatedBy: msg.actorId, version: (sc.version ?? 1) + 1,
      });
      await audit(tx, msg, "respond", "vendor_show_cause", p.id);
    });
  });

  queue.subscribe(COMMANDS.vendorShowCauseAppeal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; appealText: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sc = await repo.findShowCauseByIdTx(tx, p.id, p.tenantId);
      if (!sc) throw new Error(`show-cause ${p.id} not found`);
      assertShowCauseTransition(sc.status, "appealed");
      await repo.updateShowCause(tx, p.id, {
        status: "appealed", appealText: p.appealText, appealedAt: new Date(),
        updatedBy: msg.actorId, version: (sc.version ?? 1) + 1,
      });
      await audit(tx, msg, "appeal", "vendor_show_cause", p.id);
    });
  });

  queue.subscribe(COMMANDS.vendorShowCauseDecide, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; uphold: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sc = await repo.findShowCauseByIdTx(tx, p.id, p.tenantId);
      if (!sc) throw new Error(`show-cause ${p.id} not found`);
      // Maker-checker: the decider must differ from the issuer.
      assertDistinctIssuerDecider(sc.issuedBy, msg.actorId);
      const target = p.uphold ? "upheld" : "closed";
      assertShowCauseTransition(sc.status, target);
      await repo.updateShowCause(tx, p.id, {
        status: target, decision: p.decision, decidedBy: msg.actorId, decidedAt: new Date(),
        updatedBy: msg.actorId, version: (sc.version ?? 1) + 1,
      });
      if (p.uphold) {
        // Upheld show-cause proposes debarment — routed to the maker-checker
        // debarment flow (vendor-blacklist), not applied here directly.
        await enqueue(tx, {
          topic: EVENTS.vendorDebarmentProposed, eventType: EVENTS.vendorDebarmentProposed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { vendorId: sc.vendorId, tenantId: p.tenantId, showCauseId: p.id, reason: sc.reason },
        });
      }
      await audit(tx, msg, "decide", "vendor_show_cause", p.id);
    });
  });
}

async function recordAndRecompute(
  tx: Parameters<typeof enqueue>[0] & repo.Writer,
  args: {
    tenantId: string; actorId: string; correlationId: string; vendorId: string;
    eventType?: PerformanceEventType | undefined; source: PerformanceSource;
    sourceRef: string | null; poRef: string | null;
  },
): Promise<void> {
  // Serialize recompute per (tenant, vendor) so concurrent event handlers each
  // observe prior committed events — the tally + upsert would otherwise race on
  // a stale snapshot. Transaction-scoped: released automatically at commit.
  await (tx as unknown as typeof db).execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${args.tenantId + ":" + args.vendorId}, 0))`,
  );
  if (args.eventType) {
    await repo.insertPerfEvent(tx, {
      id: randomUUID(), tenantId: args.tenantId, vendorId: args.vendorId,
      eventType: args.eventType, source: args.source,
      sourceRef: args.sourceRef, poRef: args.poRef, weight: 1, createdBy: args.actorId,
    });
  }
  const tally = await repo.tallyEventsTx(tx, args.vendorId, args.tenantId);
  const sc = computeScorecard(tally);
  await repo.upsertScorecardTx(tx, {
    id: randomUUID(), tenantId: args.tenantId, vendorId: args.vendorId, period: "all",
    totalOrders: sc.totalOrders, onTimeDeliveries: sc.onTimeDeliveries, lateDeliveries: sc.lateDeliveries,
    qualityRejections: sc.qualityRejections, slaBreaches: sc.slaBreaches,
    deliveryScore: sc.deliveryScore, qualityScore: sc.qualityScore, slaScore: sc.slaScore,
    overallRating: sc.overallRating, ratingBand: sc.ratingBand,
  });
  await enqueue(tx, {
    topic: EVENTS.vendorScorecardComputed, eventType: EVENTS.vendorScorecardComputed,
    tenantId: args.tenantId, actorId: args.actorId, correlationId: args.correlationId,
    payload: {
      vendorId: args.vendorId, tenantId: args.tenantId,
      overallRating: sc.overallRating, ratingBand: sc.ratingBand,
    },
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
