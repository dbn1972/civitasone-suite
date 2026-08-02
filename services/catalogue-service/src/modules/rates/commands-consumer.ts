import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as externalRefRepo from "./external-ref-repo.js";

const log = pino({ name: "catalogue.rates.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRateConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createRate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      productId: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      rateValueMinor: string;
      source: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRate(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        productId: p.productId,
        effectiveDate: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        rateValue: BigInt(p.rateValueMinor),
        source: p.source,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.rateCreated,
        eventType: EVENTS.rateCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          rateId: p.id,
          productId: p.productId,
          effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo,
          rateValueMinor: p.rateValueMinor,
          source: p.source,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "rate.create",
        resourceType: "catalogue_rate",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "rate created");
  });

  queue.subscribe(COMMANDS.updateRate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      version: number;
      productId: string;
      patch: Record<string, unknown>;
      eventPatch: Record<string, unknown>;
    };
    // Rehydrate bigint money fields that travel as strings on the queue.
    const patch: Record<string, unknown> = { ...p.patch };
    if (typeof patch["rateValue"] === "string") {
      patch["rateValue"] = BigInt(patch["rateValue"] as string);
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateRate(tx, p.id, msg.tenantId, patch as never, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.rateUpdated,
        eventType: EVENTS.rateUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          rateId: p.id,
          productId: p.productId,
          previousVersion: p.version,
          ...p.eventPatch,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "rate.update",
        resourceType: "catalogue_rate",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
  });

  queue.subscribe(COMMANDS.recordRateExternalRef, async (msg) => {
    const p = msg.payload as {
      rateId: string;
      productId: string;
      sourceSystem: string;
      externalId: string;
      syncedAt: string;
      previousVersion: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await externalRefRepo.setExternalRef(
        tx,
        p.rateId,
        msg.tenantId,
        {
          sourceSystem: p.sourceSystem,
          externalId: p.externalId,
          syncedAt: new Date(p.syncedAt),
          updatedBy: msg.actorId,
        },
        p.previousVersion,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.rateExternalRefRecorded,
        eventType: EVENTS.rateExternalRefRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          rateId: p.rateId,
          productId: p.productId,
          sourceSystem: p.sourceSystem,
          externalId: p.externalId,
          syncedAt: p.syncedAt,
          previousVersion: p.previousVersion,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "rate.external_ref.record",
        resourceType: "catalogue_rate",
        resourceId: p.rateId,
      });
    });
  });
}
