import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";
import * as inspectionsRepo from "../inspections/repo.js";
import { generateNocNumber, generateVerificationCode, calculateValidUntil, checkNocEligibility } from "./domain.js";

const log = pino({ name: "fire.nocs.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerNocConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueNoc, async (msg) => {
    const p = msg.payload as {
      id: string;
      applicationId: string;
      validFrom: string;
      conditions?: Record<string, unknown>;
      durationYears?: number;
    };
    // CRITICAL fix: verify eligibility (application exists, has a completed
    // inspection with an "approve" recommendation) and that no active NOC
    // already exists for this application before issuing. routes.ts runs the
    // same check synchronously for fast 422 feedback; re-checked here because
    // this consumer is a separate async execution context.
    const application = await appRepo.findById(msg.tenantId, p.applicationId);
    const inspections = await inspectionsRepo.findByApplicationId(msg.tenantId, p.applicationId);
    const eligibility = checkNocEligibility(application, inspections);
    if (!eligibility.eligible) {
      log.error({ id: p.id, applicationId: p.applicationId, reason: eligibility.reason }, "refusing to issue NOC: application not eligible");
      return;
    }
    const existingActive = await repo.findActiveByApplicationId(msg.tenantId, p.applicationId);
    if (existingActive) {
      log.error({ id: p.id, applicationId: p.applicationId, existingNocId: existingActive.id }, "refusing to issue NOC: an active NOC already exists for this application");
      return;
    }

    const now = new Date();
    const verificationCode = generateVerificationCode();
    const validFromDate = new Date(p.validFrom);
    const validUntil = calculateValidUntil(validFromDate, p.durationYears ?? 3);
    const validUntilStr = validUntil.toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Fleet-wide fix (see migrations/0002_number_sequences.sql): a real
      // Postgres SEQUENCE, replacing the previous randomInt(1, 999999) draw
      // -- a collision risk against noc_number's UNIQUE constraint at
      // moderate volume. nextval() called inside the same transaction that
      // inserts the row (mirrors animal-service's repo.nextComplaintNumber,
      // PR #1007).
      const nocNumber = generateNocNumber("ULB", new Date().getUTCFullYear(), await repo.nextNocNumber(tx));
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        nocNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: validUntilStr,
        conditions: p.conditions ?? null,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      // Keeps the public, non-RLS verification directory in sync with the
      // tenant-scoped row created above -- see
      // migrations/0003_noc_public_directory.sql. Same transaction, so the
      // two can never drift.
      await repo.insertPublicDirectory(tx, {
        verificationCode,
        tenantId: msg.tenantId,
        nocId: p.id,
        nocNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: validUntilStr,
      });
      await enqueue(tx, {
        topic: EVENTS.nocIssued,
        eventType: EVENTS.nocIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { nocId: p.id, nocNumber, applicationId: p.applicationId, verificationCode },
      });
      await writeAudit(tx, ctxOf(msg), { action: "noc.issue", resourceType: "fire_noc", resourceId: p.id });
      log.info({ id: p.id, nocNumber }, "fire NOC issued");
    });
  });

  queue.subscribe(COMMANDS.suspendNoc, async (msg) => {
    const p = msg.payload as { nocId: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.nocId, "suspended", ["issued", "active"], msg.actorId);
      if (!row) return;
      applied = true;
      await repo.updatePublicDirectoryStatus(tx, p.nocId, "suspended");
      await enqueue(tx, { topic: EVENTS.nocSuspended, eventType: EVENTS.nocSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { nocId: p.nocId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "noc.suspend", resourceType: "fire_noc", resourceId: p.nocId });
    });
    // BUG FIX: same cache-invalidation gap as applications/consumer.ts (see
    // that file's comment) -- GET /v1/fire/nocs/:id is read-through cached
    // and nothing invalidated it on write. (The public verify directory is
    // NOT cached -- fire_noc_directory is read straight from Postgres every
    // time -- so no separate invalidation is needed for it.)
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "noc", p.nocId));
  });

  queue.subscribe(COMMANDS.revokeNoc, async (msg) => {
    const p = msg.payload as { nocId: string; reason: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // fromStatuses matches routes.ts's own pre-check exactly (block only if
      // already "revoked" — every other status, including "expired", is
      // revocable, consistent with the pre-existing route behavior).
      const row = await repo.updateStatus(tx, msg.tenantId, p.nocId, "revoked", ["issued", "active", "suspended", "expired"], msg.actorId);
      if (!row) return;
      applied = true;
      await repo.updatePublicDirectoryStatus(tx, p.nocId, "revoked");
      await enqueue(tx, { topic: EVENTS.nocRevoked, eventType: EVENTS.nocRevoked, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { nocId: p.nocId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "noc.revoke", resourceType: "fire_noc", resourceId: p.nocId });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "noc", p.nocId));
  });
}
