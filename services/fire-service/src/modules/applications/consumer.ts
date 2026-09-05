import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, MUNICIPAL_EVENT_TYPES } from "../../shared/cross-events.js";
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

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Fleet-wide fix (see migrations/0002_number_sequences.sql): a real
      // Postgres SEQUENCE, replacing the previous randomInt(1, 999999) draw
      // -- a collision risk against application_number's UNIQUE constraint
      // at moderate volume. nextval() called inside the same transaction
      // that inserts the row (mirrors animal-service's
      // repo.nextComplaintNumber, PR #1007).
      const applicationNumber = generateApplicationNumber(
        "ULB",
        new Date().getUTCFullYear(),
        await repo.nextApplicationNumber(tx),
      );
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
      // Cross-service wiring (municipal-sec5 event contract, Wave 3): the
      // fire-safety NOC fee is assessed the moment the application is
      // created — feeMinor above is server-computed entirely from a fixed
      // schedule (calculateFeeMinor: base fee by occupancyType + a flat
      // per-sqft surcharge), never a client-supplied amount, so no
      // ADMIN_ROLES gate is needed here (cross-events.ts's own
      // MAX_FEE_CHALLAN_AMOUNT_MINOR ceiling is the remaining backstop).
      // Same transaction as the application row and its own domain event —
      // all-or-nothing with the write that created the obligation.
      await emitMunicipalFeeChallan(tx, ctxOf(msg), {
        sourceRef: applicationNumber,
        depositor: p.buildingName,
        amountMinor: feeMinor,
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.create", resourceType: "fire_application", resourceId: p.id });
      log.info({ id: p.id, applicationNumber }, "fire application created");
    });
  });

  queue.subscribe(COMMANDS.submitApplication, async (msg) => {
    const p = msg.payload as { applicationId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.applicationId, "submitted", fromStatusesFor("submitted"), msg.actorId);
      if (!row) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.applicationSubmitted, eventType: EVENTS.applicationSubmitted, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId } });
      // Citizen-meaningful transition: the applicant just successfully
      // submitted their application and should get a confirmation. `row` is
      // the UPDATE ... RETURNING result from the CAS immediately above, so
      // buildingName comes from the write itself — no separate
      // recipient-lookup read is needed (and none is nested inside this
      // transaction, per the PR #1028 deadlock-class gotcha: this service
      // has no citizen-name field, so buildingName is the display identity
      // we notify, same fallback building-service uses for its own
      // no-applicant-field schema). recipientId is the application's own id
      // — this service has no separate citizen-account id either
      // (notification-service's findByRecipient scopes an inbox by
      // recipientId; building-service's identical-shape schema uses the
      // application id as that stable per-citizen-journey key throughout,
      // rather than the internal actor id that created the row).
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
        recipient: row.buildingName,
        recipientId: p.applicationId,
        variables: { applicationId: p.applicationId, applicationNumber: row.applicationNumber },
      });
      await writeAudit(tx, ctxOf(msg), { action: "application.submit", resourceType: "fire_application", resourceId: p.applicationId });
    });
    // BUG FIX: GET /v1/fire/applications/:id is read-through cached
    // (routes.ts's cache.getOrLoad) and NOTHING previously invalidated it on
    // write, in violation of CLAUDE.md §6 ("every query handler consults the
    // cache before Postgres; writes never touch the read path -- the
    // consumer invalidates here"). A citizen/officer polling that endpoint
    // right after submit would keep seeing "draft" for up to the cache's
    // default 60s TTL. Fixed to match the established fleet pattern -- see
    // e.g. services/building-service/src/modules/applications/consumer.ts.
    // Invalidated AFTER the transaction commits, not inside it (this DB
    // layer has no commit-hook), so a rolled-back write never evicts a still
    // valid cache entry.
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
  });

  queue.subscribe(COMMANDS.withdrawApplication, async (msg) => {
    const p = msg.payload as { applicationId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.applicationId, "withdrawn", fromStatusesFor("withdrawn"), msg.actorId);
      if (!row) return;
      applied = true;
      await enqueue(tx, { topic: EVENTS.applicationWithdrawn, eventType: EVENTS.applicationWithdrawn, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { applicationId: p.applicationId } });
      await writeAudit(tx, ctxOf(msg), { action: "application.withdraw", resourceType: "fire_application", resourceId: p.applicationId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
  });
}
