/**
 * Writers for the platform-ops module. Each handler runs in ONE transaction
 * under the message's tenant GUC, is idempotent through _inbox.processed, and
 * writes its audit.event.record outbox row in that same transaction. A failed
 * audit write fails the message so the queue redelivers it.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { canTransition, type OnboardingStage } from "./domain.js";
import type { CreateOnboardingPayload, DataAccessPayload, MoveOnboardingPayload } from "./commands.js";

const log = pino({ name: "admin-platform-ops-consumer" });

export function registerPlatformOpsConsumers(queue: Queue): void {
  queue.subscribe<DataAccessPayload & { id: string; tenantId: string }>(COMMANDS.platformDataAccess, async (msg) => {
    const p = msg.payload;
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Only whether a filter was active is recorded, never the raw search text.
      await auditEvent(
        tx,
        { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        p.kind, `platform_${p.resource}`, p.resourceId ?? "list",
        {
          ...(p.rowCount !== undefined ? { rowCount: p.rowCount } : {}),
          ...(p.filtered !== undefined ? { filtered: p.filtered } : {}),
          ...(p.reason ? { reason: p.reason } : {}),
          ...(p.fields ? { fields: p.fields } : {}),
        },
      );
    }));
  });

  queue.subscribe<CreateOnboardingPayload & { id: string; tenantId: string }>(COMMANDS.onboardingCreate, async (msg) => {
    const p = msg.payload;
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertOnboarding(tx, {
        id: p.id, tenantId: msg.tenantId, orgName: p.orgName, contactName: p.contactName,
        contactEmail: p.contactEmail, notes: p.notes ?? null, createdBy: msg.actorId,
      });
      // The contact is personal data: the audit row carries the organisation, never the contact.
      await auditEvent(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        "create", "onboarding_request", p.id, { orgName: p.orgName });
    }));
  });

  queue.subscribe<MoveOnboardingPayload & { id: string; tenantId: string }>(COMMANDS.onboardingMove, async (msg) => {
    const p = msg.payload;
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // The consumer is the authority: re-check the edge even though the route did.
      if (!canTransition(p.from as OnboardingStage, p.to as OnboardingStage)) {
        log.warn({ requestId: p.requestId, from: p.from, to: p.to }, "onboarding move rejected: illegal transition");
        return;
      }
      const moved = await repo.moveStageConditional(tx, msg.tenantId, p.requestId, p.from as OnboardingStage, p.to as OnboardingStage, {
        assignedTo: p.assignedTo, assignedToName: p.assignedToName, provisionedTenantId: p.provisionedTenantId,
      });
      if (!moved) {
        // Lost the race (another operator moved it first): nothing changed, nothing to audit as a success.
        log.info({ requestId: p.requestId, from: p.from }, "onboarding move skipped: stage already changed");
        return;
      }
      await auditEvent(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        "stage_change", "onboarding_request", p.requestId,
        { from: p.from, to: p.to, ...(p.note ? { note: p.note } : {}), ...(p.provisionedTenantId ? { provisionedTenantId: p.provisionedTenantId } : {}) });
    }));
  });
}
