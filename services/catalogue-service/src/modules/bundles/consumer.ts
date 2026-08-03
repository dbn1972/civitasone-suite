import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as approvalRepo from "./approvals-repo.js";

const log = pino({ name: "catalogue.bundles.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerBundleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createBundle, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      description: string | null;
      componentProductIds: string[];
      pricingApprovalRequired: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBundle(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        description: p.description,
        componentProductIds: p.componentProductIds,
        pricingApprovalRequired: p.pricingApprovalRequired,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.bundleCreated,
        eventType: EVENTS.bundleCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          bundleId: p.id,
          name: p.name,
          componentProductIds: p.componentProductIds,
          pricingApprovalRequired: p.pricingApprovalRequired,
          status: "active",
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "bundle.create",
        resourceType: "catalogue_bundle",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "bundle created");
  });

  queue.subscribe(COMMANDS.updateBundle, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      version: number;
      patch: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateBundle(tx, p.id, msg.tenantId, p.patch as never, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.bundleUpdated,
        eventType: EVENTS.bundleUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bundleId: p.id, patch: p.patch, previousVersion: p.version },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "bundle.update",
        resourceType: "catalogue_bundle",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
  });

  queue.subscribe(COMMANDS.deleteBundle, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.softDeleteBundle(tx, p.id, msg.tenantId, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.bundleDeleted,
        eventType: EVENTS.bundleDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { bundleId: p.id, status: "deleted", previousVersion: p.version },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "bundle.delete",
        resourceType: "catalogue_bundle",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.requestBundleApproval, async (msg) => {
    const p = msg.payload as {
      approvalId: string;
      bundleId: string;
      pricingAmountMinor: string;
      currency: string;
      reason: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await approvalRepo.insertApproval(tx, {
        id: p.approvalId,
        tenantId: msg.tenantId,
        bundleId: p.bundleId,
        status: "pending",
        requestedBy: msg.actorId,
        reason: p.reason,
        pricingAmountMinor: BigInt(p.pricingAmountMinor),
        currency: p.currency,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.bundleApprovalRequested,
        eventType: EVENTS.bundleApprovalRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          approvalId: p.approvalId,
          bundleId: p.bundleId,
          requestedBy: msg.actorId,
          pricingAmountMinor: p.pricingAmountMinor,
          currency: p.currency,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "bundle_approval.request",
        resourceType: "catalogue_bundle_approval",
        resourceId: p.approvalId,
      });
    });
    log.info({ id: p.approvalId }, "bundle approval requested");
  });

  queue.subscribe(COMMANDS.decideBundleApproval, async (msg) => {
    const p = msg.payload as {
      approvalId: string;
      bundleId: string;
      decision: string;
      reason: string | null;
      requestedBy: string;
      version: number;
      pricingAmountMinor: string | null;
      decidedAt: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await approvalRepo.decideApproval(
        tx,
        p.approvalId,
        msg.tenantId,
        {
          status: p.decision,
          decidedBy: msg.actorId,
          decidedAt: new Date(p.decidedAt),
          approvedBy: p.decision === "approved" ? msg.actorId : null,
          reason: p.reason,
        },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.bundleApprovalDecided,
        eventType: EVENTS.bundleApprovalDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          approvalId: p.approvalId,
          bundleId: p.bundleId,
          decision: p.decision,
          requestedBy: p.requestedBy,
          decidedBy: msg.actorId,
          decidedAt: p.decidedAt,
          ...(p.reason !== null ? { reason: p.reason } : {}),
          pricingAmountMinor: p.pricingAmountMinor,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "bundle_approval.decide",
        resourceType: "catalogue_bundle_approval",
        resourceId: p.approvalId,
        details: { decision: p.decision },
      });
    });
  });
}
