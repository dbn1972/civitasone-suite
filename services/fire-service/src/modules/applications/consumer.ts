import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { randomInt } from "node:crypto";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { calculateFeeMinor, generateApplicationNumber, fromStatusesFor } from "./domain.js";

const log = pino({ name: "fire.applications.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApplicationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createApplication, async (msg) => {
    const p = msg.payload as {
      id: string;
      buildingName: string;
      buildingAddress: Record<string, unknown>;
      occupancyType: string;
      buildingHeight?: string;
      numberOfFloors?: number;
      builtUpArea?: string;
      fireSafetyMeasures?: Record<string, unknown>;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    // Was: `parseInt(...) || 0` silently treats a non-numeric builtUpArea
    // string identically to "not provided," zeroing the area-based fee
    // surcharge instead of surfacing the bad input. Routes.ts's Zod schema
    // only checks it's *a* string, not a numeric one, so this was reachable.
    // NaN is caught explicitly now rather than silently coerced to 0 fee impact.
    let builtUpAreaSqft = 0;
    if (p.builtUpArea) {
      const parsed = parseInt(p.builtUpArea, 10);
      if (Number.isNaN(parsed)) {
        log.warn({ id: p.id, builtUpArea: p.builtUpArea }, "non-numeric builtUpArea; treating area surcharge as 0");
      } else {
        builtUpAreaSqft = Math.max(0, parsed);
      }
    }
    const feeMinor = calculateFeeMinor(p.occupancyType as never, builtUpAreaSqft);
    // Mitigation, not a full fix — Date.now() % 999999 collides across ALL
    // tenants against a globally-unique column; see the PR description for
    // the full mechanism (same pattern flagged fleet-wide in this pass).
    const applicationNumber = generateApplicationNumber("ULB", new Date().getUTCFullYear(), randomInt(1, 999999));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationNumber,
        status: "draft",
        buildingName: p.buildingName,
        buildingAddress: p.buildingAddress as never,
        occupancyType: p.occupancyType,
        buildingHeight: p.buildingHeight ?? null,
        numberOfFloors: p.numberOfFloors ?? null,
        builtUpArea: p.builtUpArea ?? null,
        fireSafetyMeasures: p.fireSafetyMeasures ?? null,
        documents: p.documents ?? null,
        feeMinor,
        feeCurrency: "INR",
        feePaid: false,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.applicationCreated,
        eventType: EVENTS.applicationCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { applicationId: p.id, applicationNumber, buildingName: p.buildingName, feeMinor: String(feeMinor) },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "fire_application", resourceId: p.id });
    });
    log.info({ id: p.id, applicationNumber }, "fire application created");
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { applicationId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.applicationId, "submitted", fromStatusesFor("submitted"), msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "fire_application", resourceId: p.applicationId });
    });
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { applicationId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.applicationId, "withdrawn", fromStatusesFor("withdrawn"), msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "fire_application", resourceId: p.applicationId });
    });
  });
}
