import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as registryRepo from "../registry/repo.js";
import * as repo from "./repo.js";
import { marketplaceReviews } from "./schema.js";
import { and, eq } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

export interface MarketplaceInstallPayload {
  installId: string;
  pluginId: string; // marketplace listing id (name kept for wire compatibility with the publisher)
  tenantId: string;
  reason?: string;
}

export interface MarketplaceReviewPayload {
  pluginId: string; // marketplace listing id (wire name kept from the publisher)
  rating: number;
  comment?: string;
  reviewerId: string;
}

type Outcome = "success" | "failure" | "skipped";

/**
 * Performs a marketplace install by reusing the registry install path
 * (registry.plugins row in state "installed" + plugins.registry.installed event),
 * exactly what plugins.registry.install does for an uploaded manifest.
 *
 * markProcessed, the guarded write and the audit row share ONE transaction, so a
 * crash redelivers the whole thing and a redelivery of an applied message is a
 * no-op. The registry row id IS the installId, so even a bypassed inbox could not
 * create a second row. A tenant that already holds the listing is not given a
 * second copy (outcome "skipped"), and an unknown/inactive listing is audited as a
 * failure and acked (retrying cannot fix it).
 */
export function registerMarketplaceConsumers(queue: Queue): void {
  queue.subscribe<MarketplaceInstallPayload>(COMMANDS.marketplaceInstall, async (msg) => {
    let installed = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const reason = typeof p.reason === "string" ? p.reason : null;
      const t = tx as Parameters<typeof enqueue>[0];
      const audit = (outcome: Outcome, resourceId: string, detail?: string) =>
        enqueue(t, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "plugins", action: "marketplace.install", resourceType: "plugin", resourceId, outcome,
            reason,
            newValue: { listingId: p.pluginId, installId: p.installId, reason, ...(detail ? { detail } : {}) },
          },
        });

      const listing = await repo.findListingTx(tx, p.pluginId);
      if (!listing || !listing.isActive) { await audit("failure", p.pluginId, "LISTING_UNAVAILABLE"); return; }
      const existing = await repo.findInstalledByListingTx(tx, msg.tenantId, listing.id);
      if (existing) { await audit("skipped", existing.id, "ALREADY_INSTALLED"); return; }

      await registryRepo.insert(tx, {
        id: p.installId,
        tenantId: msg.tenantId,
        manifestJson: {
          name: listing.name, version: listing.version, publisher: listing.publisher,
          description: listing.description, category: listing.category,
          source: "marketplace", marketplaceListingId: listing.id,
        },
        state: "installed",
        installedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await repo.bumpInstallCountTx(tx, listing.id);
      await enqueue(t, { topic: EVENTS.pluginInstalled, eventType: EVENTS.pluginInstalled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { pluginId: p.installId } });
      await audit("success", p.installId);
      installed = true;
    });
    if (installed) await cache.invalidateResource(msg.tenantId, "plugin");
  });

  registerReviewConsumer(queue);
}

/**
 * plugin.marketplace.review: records (or updates) the reviewer's single review of a
 * listing and folds the rating delta into the listing's running average.
 *
 * markProcessed, the review write, the listing rating update and the audit row share
 * ONE transaction. messageId is stored on the review row so the web can tell its own
 * submission was applied. A redelivery is a no-op via the inbox. The comment text is
 * never copied into the audit payload (only whether one was given).
 */
function registerReviewConsumer(queue: Queue): void {
  queue.subscribe<MarketplaceReviewPayload>(COMMANDS.marketplaceReview, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const t = tx as Parameters<typeof enqueue>[0];
      const comment = typeof p.comment === "string" && p.comment.trim() ? p.comment.trim().slice(0, 1000) : null;
      const audit = (outcome: Outcome, detail?: string, extra: Record<string, unknown> = {}) =>
        enqueue(t, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "plugins", action: "marketplace.review", resourceType: "plugin", resourceId: p.pluginId, outcome,
            newValue: { listingId: p.pluginId, reviewId: msg.messageId, rating: p.rating, hasComment: comment !== null, ...(detail ? { detail } : {}), ...extra },
          },
        });

      const rating = Number(p.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) { await audit("failure", "INVALID_RATING"); return; }
      const listing = await repo.findListingTx(tx, p.pluginId);
      if (!listing || !listing.isActive) { await audit("failure", "LISTING_UNAVAILABLE"); return; }

      const existing = await repo.findReviewTx(tx, msg.tenantId, listing.id, msg.actorId);
      if (existing) {
        await tx.update(marketplaceReviews)
          .set({ rating, comment, messageId: msg.messageId, updatedAt: new Date(), updatedBy: msg.actorId, version: existing.version + 1 })
          .where(and(eq(marketplaceReviews.id, existing.id), eq(marketplaceReviews.tenantId, msg.tenantId)));
        await repo.applyRatingTx(tx, listing.id, rating - existing.rating, 0);
        await audit("success", undefined, { previousRating: existing.rating, updated: true });
      } else {
        await tx.insert(marketplaceReviews).values({
          tenantId: msg.tenantId, listingId: listing.id, reviewerId: msg.actorId, rating, comment,
          messageId: msg.messageId, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
        await repo.applyRatingTx(tx, listing.id, rating, 1);
        await audit("success");
      }
    });
  });
}
