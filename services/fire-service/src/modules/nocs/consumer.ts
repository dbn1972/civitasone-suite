import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { randomInt } from "node:crypto";
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
    // Mitigation, not a full fix — Date.now() % 999999 collision pattern
    // flagged across every service in this pass.
    const nocNumber = generateNocNumber("ULB", new Date().getUTCFullYear(), randomInt(1, 999999));
    const verificationCode = generateVerificationCode();
    const validFromDate = new Date(p.validFrom);
    const validUntil = calculateValidUntil(validFromDate, p.durationYears ?? 3);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        nocNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: validUntil.toISOString().slice(0, 10),
        conditions: p.conditions ?? null,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
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
    });
    log.info({ id: p.id, nocNumber }, "fire NOC issued");
  });

  queue.subscribe(COMMANDS.suspendNoc, async (msg) => {
    const p = msg.payload as { nocId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.nocId, "suspended", ["issued", "active"], msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.nocSuspended, eventType: EVENTS.nocSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { nocId: p.nocId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "noc.suspend", resourceType: "fire_noc", resourceId: p.nocId });
    });
  });

  queue.subscribe(COMMANDS.revokeNoc, async (msg) => {
    const p = msg.payload as { nocId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // fromStatuses matches routes.ts's own pre-check exactly (block only if
      // already "revoked" — every other status, including "expired", is
      // revocable, consistent with the pre-existing route behavior).
      const row = await repo.updateStatus(tx, msg.tenantId, p.nocId, "revoked", ["issued", "active", "suspended", "expired"], msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.nocRevoked, eventType: EVENTS.nocRevoked, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { nocId: p.nocId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "noc.revoke", resourceType: "fire_noc", resourceId: p.nocId });
    });
  });
}
