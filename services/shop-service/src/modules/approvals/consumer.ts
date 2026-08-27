import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../registrations/repo.js";
import { validateScrutinyComplete, canDecide, type ScrutinyFinding } from "./domain.js";

const log = pino({ name: "shop.approvals.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerApprovalConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.initiateScrutiny, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicationId: string;
      scrutinyType: string;
      officerId: string;
    };
    // Re-validate against the CURRENT persisted status — the route only checked a
    // snapshot at request time. Matches the route's own precondition: scrutiny can
    // be (re-)initiated while "submitted" or already "under_scrutiny" (a second/
    // third scrutiny type on the same application), but not once decided/withdrawn.
    const application = await appRepo.findById(p.applicationId, msg.tenantId);
    if (!application || (application.status !== "submitted" && application.status !== "under_scrutiny")) {
      log.warn(
        { applicationId: p.applicationId, currentStatus: application?.status },
        "initiateScrutiny: stale or invalid transition, skipping",
      );
      return;
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Apply the application-status transition FIRST as an atomic
      // compare-and-swap; only insert the scrutiny record once it succeeds, so a
      // lost race never leaves an orphaned "pending" scrutiny hanging off an
      // application that has already moved on (e.g. been decided in the interim).
      const ok = await appRepo.updateStatus(
        tx, p.applicationId, msg.tenantId, ["submitted", "under_scrutiny"], "under_scrutiny", msg.actorId,
      );
      if (!ok) return;
      await repo.insertScrutiny(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        scrutinyType: p.scrutinyType,
        officerId: p.officerId,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.scrutinyInitiated,
        eventType: EVENTS.scrutinyInitiated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          scrutinyId: p.id,
          applicationId: p.applicationId,
          scrutinyType: p.scrutinyType,
          officerId: p.officerId,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "scrutiny.initiate",
        resourceType: "shop_scrutiny_record",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, applicationId: p.applicationId }, "scrutiny initiated");
  });

  queue.subscribe(COMMANDS.completeScrutiny, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      findings: Record<string, unknown>;
      deficiencyDetails?: string;
    };
    // Re-validate against the CURRENT persisted status — matches the route's own
    // ALREADY_COMPLETED precondition, so a stale/duplicate complete command can't
    // silently overwrite an already-recorded outcome (e.g. replace a
    // deficiency_found result with fabricated all-pass findings via a retry).
    const existing = await repo.findById(p.id, msg.tenantId);
    if (!existing || existing.status !== "pending") {
      log.warn(
        { id: p.id, currentStatus: existing?.status },
        "completeScrutiny: stale or already-completed scrutiny, skipping",
      );
      return;
    }

    const findingsList = (p.findings["items"] ?? []) as ScrutinyFinding[];
    const { allPassed, deficiencies } = validateScrutinyComplete(findingsList);
    const status = allPassed ? "completed" : "deficiency_found";
    const defText = deficiencies.length > 0 ? deficiencies.join("; ") : (p.deficiencyDetails ?? null);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.completeScrutiny(tx, p.id, msg.tenantId, ["pending"], status, p.findings, defText, msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.scrutinyCompleted,
        eventType: EVENTS.scrutinyCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { scrutinyId: p.id, status, deficiencies },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "scrutiny.complete",
        resourceType: "shop_scrutiny_record",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.decideApplication, async (msg) => {
    const p = msg.payload as {
      applicationId: string;
      tenantId: string;
      decision: string;
      reason?: string;
    };
    // Re-validate against the CURRENT persisted status. The route only checked a
    // snapshot at request time; async delivery is not guaranteed ordered, so two
    // racing decisions (or a decide racing a withdraw) must not both silently land.
    const current = await appRepo.findById(p.applicationId, msg.tenantId);
    if (!current || !canDecide(current.status)) {
      log.warn(
        { applicationId: p.applicationId, currentStatus: current?.status },
        "decideApplication: stale or invalid transition, skipping",
      );
      return;
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await appRepo.updateStatus(
        tx, p.applicationId, msg.tenantId, ["under_scrutiny", "inspecting"], p.decision, msg.actorId,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.applicationDecided,
        eventType: EVENTS.applicationDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          applicationId: p.applicationId,
          decision: p.decision,
          reason: p.reason,
          decidedBy: msg.actorId,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: `application.${p.decision}`,
        resourceType: "shop_application",
        resourceId: p.applicationId,
      });
    });
    log.info({ applicationId: p.applicationId, decision: p.decision }, "application decided");
  });
}
