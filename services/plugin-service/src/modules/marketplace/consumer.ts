import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as registryRepo from "../registry/repo.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export interface MarketplaceInstallPayload {
  installId: string;
  pluginId: string; // marketplace listing id (name kept for wire compatibility with the publisher)
  tenantId: string;
  reason?: string;
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
}
