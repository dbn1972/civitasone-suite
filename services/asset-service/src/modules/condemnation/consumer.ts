/**
 * Condemnation consumer — handles survey, recommendation, auction commands.
 *
 * On auction complete:
 *   1. Updates asset status to "condemned"/"disposed"
 *   2. Posts sale proceeds to finance (finance.receipt.create)
 *   3. Stops depreciation (asset retirement)
 *   4. Emits asset.disposed event
 *
 * Maker-checker: recommendation approval checks approver ≠ creator.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { assertMakerChecker, assertBidMeetsFloor } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";
import { condemnationSurveys, condemnationRecommendations, assetAuctions } from "./schema.js";
import { assetAssets } from "../register/schema.js";

const log = pino({ name: "condemnation-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC = "finance.gl.post";
const FINANCE_RECEIPT_TOPIC = "finance.receipt.create";

export function registerCondemnationConsumers(queue: Queue): void {
  // ── Survey Create ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.condemnationSurveyCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; assetId: string; surveyDate: string;
        condition: string; conditionNotes?: string; yearsInUse?: number;
        estimatedRepairCostMinor?: number; currency: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(condemnationSurveys).values({
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          surveyDate: p.surveyDate, surveyedBy: msg.actorId,
          condition: p.condition, conditionNotes: p.conditionNotes ?? null,
          yearsInUse: p.yearsInUse ?? null,
          estimatedRepairCostMinor: p.estimatedRepairCostMinor ? BigInt(p.estimatedRepairCostMinor) : null,
          currency: p.currency, status: "draft",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "survey_created", "condemnation_survey", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "condemnationSurveyCreate failed"); }
  });

  // ── Survey Submit ──────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.condemnationSurveySubmit, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number; recommendation: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.update(condemnationSurveys)
          .set({ status: "submitted", recommendation: p.recommendation, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${condemnationSurveys.version} + 1` })
          .where(and(eq(condemnationSurveys.id, p.id), eq(condemnationSurveys.tenantId, p.tenantId), eq(condemnationSurveys.version, p.version)));
        await audit(tx, msg, "survey_submitted", "condemnation_survey", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "condemnationSurveySubmit failed"); }
  });

  // ── Recommendation Create ──────────────────────────────────────────────
  queue.subscribe(COMMANDS.condemnationRecommend, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; surveyId: string; assetId: string;
        committeeMembers: unknown[]; decision: string; reason: string;
        reserveValueMinor?: number; floorValueMinor?: number; currency: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(condemnationRecommendations).values({
          id: p.id, tenantId: p.tenantId, surveyId: p.surveyId, assetId: p.assetId,
          committeeMembers: p.committeeMembers,
          decision: p.decision, reason: p.reason,
          reserveValueMinor: p.reserveValueMinor ? BigInt(p.reserveValueMinor) : null,
          floorValueMinor: p.floorValueMinor ? BigInt(p.floorValueMinor) : null,
          currency: p.currency, status: "pending",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "recommendation_created", "condemnation_recommendation", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "condemnationRecommend failed"); }
  });

  // ── Recommendation Approve (maker-checker) ─────────────────────────────
  queue.subscribe(COMMANDS.condemnationApprove, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(condemnationRecommendations)
          .where(and(eq(condemnationRecommendations.id, p.id), eq(condemnationRecommendations.tenantId, p.tenantId))).limit(1);
        const rec = rows[0];
        if (!rec) throw new Error("RECOMMENDATION_NOT_FOUND");
        assertMakerChecker(rec.createdBy, msg.actorId);
        await tx.update(condemnationRecommendations)
          .set({ status: "approved", approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${condemnationRecommendations.version} + 1` })
          .where(and(eq(condemnationRecommendations.id, p.id), eq(condemnationRecommendations.version, p.version)));

        // If decision is 'condemn', update asset status
        if (rec.decision === "condemn") {
          await tx.update(assetAssets)
            .set({ status: "condemned", updatedBy: msg.actorId, updatedAt: new Date() })
            .where(and(eq(assetAssets.id, rec.assetId), eq(assetAssets.tenantId, p.tenantId)));
          await cache.invalidate(cache.makeKey(p.tenantId, "asset", rec.assetId));
        }
        await audit(tx, msg, "recommendation_approved", "condemnation_recommendation", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "condemnationApprove failed"); }
  });

  // ── Auction Create ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.auctionCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; assetId: string; recommendationId: string;
        reserveValueMinor: number; currency: string; auctionDate?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(assetAuctions).values({
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          recommendationId: p.recommendationId,
          reserveValueMinor: BigInt(p.reserveValueMinor),
          currency: p.currency, auctionDate: p.auctionDate ?? null,
          status: "pending", createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "auction_created", "asset_auction", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "auctionCreate failed"); }
  });

  // ── Auction Complete → finance receipt + asset retirement ──────────────
  queue.subscribe(COMMANDS.auctionComplete, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; version: number;
        highestBidMinor: number; winnerName: string; winnerRef?: string;
        saleProceedsMinor: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(assetAuctions)
          .where(and(eq(assetAuctions.id, p.id), eq(assetAuctions.tenantId, p.tenantId))).limit(1);
        const auction = rows[0];
        if (!auction) throw new Error("AUCTION_NOT_FOUND");

        // Validate bid meets reserve
        assertBidMeetsFloor(BigInt(p.highestBidMinor), auction.reserveValueMinor);

        // Update auction record
        await tx.update(assetAuctions)
          .set({
            highestBidMinor: BigInt(p.highestBidMinor),
            winnerName: p.winnerName, winnerRef: p.winnerRef ?? null,
            saleProceedsMinor: BigInt(p.saleProceedsMinor),
            status: "completed", updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${assetAuctions.version} + 1`,
          })
          .where(and(eq(assetAuctions.id, p.id), eq(assetAuctions.version, p.version)));

        // Retire the asset (status → disposed, depreciation stops)
        await tx.update(assetAssets)
          .set({ status: "disposed", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(assetAssets.id, auction.assetId), eq(assetAssets.tenantId, p.tenantId)));

        // Emit sale proceeds to finance as a receipt
        await enqueue(tx, {
          topic: FINANCE_RECEIPT_TOPIC, eventType: FINANCE_RECEIPT_TOPIC,
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            type: "asset_auction_sale",
            amountMinor: p.saleProceedsMinor,
            currency: auction.currency,
            description: `Auction sale proceeds - Asset ${auction.assetId}`,
            refType: "asset_auction",
            refId: p.id,
            assetId: auction.assetId,
          },
        });

        // Emit disposal GL journal (for accounting: debit cash, credit asset)
        const assetRows = await tx.select().from(assetAssets)
          .where(eq(assetAssets.id, auction.assetId)).limit(1);
        const asset = assetRows[0];
        if (asset) {
          await enqueue(tx, {
            topic: GL_TOPIC, eventType: GL_TOPIC,
            tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              type: "asset_disposal_auction",
              assetId: auction.assetId,
              acquisitionCost: asset.acquisitionCost.toString(),
              accumulatedDep: asset.accumulatedDep.toString(),
              proceeds: p.saleProceedsMinor,
              currency: auction.currency,
            },
          });
        }

        // Emit asset.disposed event
        await enqueue(tx, {
          topic: EVENTS.assetDisposed, eventType: EVENTS.assetDisposed,
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { assetId: auction.assetId, disposalMethod: "auction", saleProceedsMinor: p.saleProceedsMinor },
        });

        await cache.invalidate(cache.makeKey(p.tenantId, "asset", auction.assetId));
        await audit(tx, msg, "auction_completed", "asset_auction", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "auctionComplete failed"); }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", module: "condemnation", action, resourceType, resourceId, outcome: "success" },
  });
}
