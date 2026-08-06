/**
 * journeys module — command consumers (G1 + G2).
 *
 * Every handler follows the service's one shape: markProcessed FIRST (so a redelivery is a
 * no-op), then the guarded write, then the domain event + audit event into the outbox inside
 * the same transaction, then cache invalidation after the transaction has committed.
 *
 * A guarded UPDATE that matches nothing is NOT an error: it means the row moved (version
 * bumped, already published, already deleted) between the route's read and the write. That
 * is audited with a non-success outcome rather than thrown, because throwing would redeliver
 * a command that can never succeed until it dead-letters.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { RESOURCES } from "./queries.js";
import type { Governance, JourneyStep } from "./schema.js";

const log = pino({ name: "crm-journeys-consumer" });

const STAGE_RESOURCE_TYPE = "stage_vocabulary";
const TEMPLATE_RESOURCE_TYPE = "journey_template";

function ctxOf(msg: CommandEnvelope): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

async function invalidateStage(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOURCES.stage, id));
  await cache.invalidateResource(tenantId, RESOURCES.stage);
  await cache.invalidateResource(tenantId, RESOURCES.resolved);
}

async function invalidateTemplate(tenantId: string, ...ids: string[]): Promise<void> {
  for (const id of ids) {
    await cache.invalidate(cache.makeKey(tenantId, RESOURCES.template, id));
    await cache.invalidate(cache.makeKey(tenantId, RESOURCES.resolved, id));
  }
  await cache.invalidateResource(tenantId, RESOURCES.template);
  await cache.invalidateResource(tenantId, RESOURCES.resolved);
}

const AUDIT_TOPIC = "audit.event.record";

/**
 * Audit a command that changed nothing. Deliberately NOT emitWithAudit: there is no domain
 * event to publish, and telling downstream consumers something changed when it did not is
 * how a stale projection is born. The audit row still records that the attempt happened.
 */
async function auditOnly(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType, resourceId, outcome },
  });
}

interface CreateStagePayload {
  id: string;
  tenantId: string;
  stageCode: string;
  displayName: string;
  description: string | null;
  ordinal: number;
  required: boolean;
  governance: Governance;
}

interface UpdateStagePayload {
  id: string;
  tenantId: string;
  displayName?: string;
  description?: string | null;
  ordinal?: number;
  required?: boolean;
  version: number;
}

interface CreateTemplatePayload {
  id: string;
  tenantId: string;
  templateKey: string;
  name: string;
  description: string | null;
  parentTemplateId: string | null;
  product: string | null;
  region: string | null;
  businessUnit: string | null;
  steps: JourneyStep[];
  versionNumber: number;
  governance: Governance;
}

interface UpdateTemplatePayload {
  id: string;
  tenantId: string;
  name?: string;
  description?: string | null;
  steps?: JourneyStep[];
  product?: string | null;
  region?: string | null;
  businessUnit?: string | null;
  version: number;
}

interface PublishTemplatePayload {
  id: string;
  tenantId: string;
  steps: JourneyStep[] | null;
  newTemplateId: string | null;
  versionNumber: number;
}

export function registerJourneyConsumers(queue: Queue): void {
  // ── Stage vocabulary ─────────────────────────────────────────────────────────

  queue.subscribe<CreateStagePayload>(COMMANDS.createStageCode, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertStage(tx, {
          id: p.id,
          tenantId: p.tenantId,
          stageCode: p.stageCode,
          displayName: p.displayName,
          description: p.description,
          ordinal: p.ordinal,
          required: p.required,
          governance: p.governance,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.stageCodeCreated,
          action: "create",
          resourceType: STAGE_RESOURCE_TYPE,
          resourceId: p.id,
          payload: {
            stageId: p.id,
            stageCode: p.stageCode,
            ordinal: p.ordinal,
            required: p.required,
            governance: p.governance,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, tenantId: msg.tenantId }, "createStageCode failed");
      throw err;
    }
    await invalidateStage(msg.tenantId, p.id);
  });

  queue.subscribe<UpdateStagePayload>(COMMANDS.updateStageCode, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch = {
        ...(p.displayName !== undefined ? { displayName: p.displayName } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.ordinal !== undefined ? { ordinal: p.ordinal } : {}),
        ...(p.required !== undefined ? { required: p.required } : {}),
      };
      const updated = await repo.updateStageWithVersion(tx, p.id, p.tenantId, p.version, patch, msg.actorId);
      if (!updated) {
        await auditOnly(tx, msg, "update", STAGE_RESOURCE_TYPE, p.id, "version_conflict");
        return;
      }
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.stageCodeUpdated,
        action: "update",
        resourceType: STAGE_RESOURCE_TYPE,
        resourceId: p.id,
        payload: { stageId: p.id, changed: Object.keys(patch) },
      });
    });
    await invalidateStage(msg.tenantId, p.id);
  });

  queue.subscribe<{ id: string; tenantId: string }>(COMMANDS.deleteStageCode, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await repo.softDeleteStage(tx, p.id, p.tenantId, msg.actorId);
      if (!deleted) {
        await auditOnly(tx, msg, "delete", STAGE_RESOURCE_TYPE, p.id, "not_applicable");
        return;
      }
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.stageCodeDeleted,
        action: "delete",
        resourceType: STAGE_RESOURCE_TYPE,
        resourceId: p.id,
        payload: { stageId: p.id },
      });
    });
    await invalidateStage(msg.tenantId, p.id);
  });

  // ── Journey templates ────────────────────────────────────────────────────────

  queue.subscribe<CreateTemplatePayload>(COMMANDS.createJourneyTemplate, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertTemplate(tx, {
          id: p.id,
          tenantId: p.tenantId,
          templateKey: p.templateKey,
          name: p.name,
          description: p.description,
          governance: p.governance,
          parentTemplateId: p.parentTemplateId,
          product: p.product,
          region: p.region,
          businessUnit: p.businessUnit,
          steps: p.steps,
          versionNumber: p.versionNumber,
          status: "draft",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.journeyTemplateCreated,
          action: "create",
          resourceType: TEMPLATE_RESOURCE_TYPE,
          resourceId: p.id,
          payload: {
            templateId: p.id,
            templateKey: p.templateKey,
            versionNumber: p.versionNumber,
            parentTemplateId: p.parentTemplateId,
            stepCount: p.steps.length,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, tenantId: msg.tenantId }, "createJourneyTemplate failed");
      throw err;
    }
    await invalidateTemplate(msg.tenantId, p.id);
  });

  queue.subscribe<UpdateTemplatePayload>(COMMANDS.updateJourneyTemplate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch = {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.steps !== undefined ? { steps: p.steps } : {}),
        ...(p.product !== undefined ? { product: p.product } : {}),
        ...(p.region !== undefined ? { region: p.region } : {}),
        ...(p.businessUnit !== undefined ? { businessUnit: p.businessUnit } : {}),
      };
      const updated = await repo.updateTemplateWithVersion(tx, p.id, p.tenantId, p.version, patch, msg.actorId);
      if (!updated) {
        await auditOnly(tx, msg, "update", TEMPLATE_RESOURCE_TYPE, p.id, "version_conflict");
        return;
      }
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.journeyTemplateUpdated,
        action: "update",
        resourceType: TEMPLATE_RESOURCE_TYPE,
        resourceId: p.id,
        payload: { templateId: p.id, changed: Object.keys(patch) },
      });
    });
    await invalidateTemplate(msg.tenantId, p.id);
  });

  queue.subscribe<{ id: string; tenantId: string }>(COMMANDS.deleteJourneyTemplate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await repo.softDeleteTemplate(tx, p.id, p.tenantId, msg.actorId);
      if (!deleted) {
        await auditOnly(tx, msg, "delete", TEMPLATE_RESOURCE_TYPE, p.id, "not_applicable");
        return;
      }
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.journeyTemplateDeleted,
        action: "delete",
        resourceType: TEMPLATE_RESOURCE_TYPE,
        resourceId: p.id,
        payload: { templateId: p.id },
      });
    });
    await invalidateTemplate(msg.tenantId, p.id);
  });

  /**
   * Publish. Two shapes, one transaction each:
   *   steps === null  → the draft becomes the live definition in place.
   *   steps supplied  → a NEW row carrying the new definition is inserted at
   *                     versionNumber, and the row it supersedes is deprecated. The old row
   *                     survives untouched, which is the point: journey instances that ran
   *                     under it still resolve to what they actually ran under.
   */
  queue.subscribe<PublishTemplatePayload>(COMMANDS.publishJourneyTemplate, async (msg) => {
    const p = msg.payload;
    const touched: string[] = [p.id];
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const current = await repo.findTemplateByIdTx(tx, p.id, p.tenantId);
        if (!current) {
          await auditOnly(tx, msg, "publish", TEMPLATE_RESOURCE_TYPE, p.id, "not_found");
          return;
        }

        if (p.steps === null || p.newTemplateId === null) {
          const published = await repo.markPublished(tx, p.id, p.tenantId, msg.actorId);
          if (!published) {
            await auditOnly(tx, msg, "publish", TEMPLATE_RESOURCE_TYPE, p.id, "invalid_status");
            return;
          }
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.journeyTemplatePublished,
            action: "publish",
            resourceType: TEMPLATE_RESOURCE_TYPE,
            resourceId: p.id,
            payload: {
              templateId: p.id,
              templateKey: current.templateKey,
              versionNumber: current.versionNumber,
              supersededTemplateId: null,
            },
          });
          return;
        }

        await repo.insertTemplate(tx, {
          id: p.newTemplateId,
          tenantId: p.tenantId,
          templateKey: current.templateKey,
          name: current.name,
          description: current.description,
          governance: current.governance,
          parentTemplateId: current.parentTemplateId,
          product: current.product,
          region: current.region,
          businessUnit: current.businessUnit,
          steps: p.steps,
          versionNumber: p.versionNumber,
          status: "published",
          publishedAt: new Date(),
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        // Retire whatever the new version supersedes. A draft is soft-deleted (it never was
        // the live definition); a published row is deprecated so it stays readable.
        if (current.status === "published") {
          await repo.markDeprecated(tx, p.id, p.tenantId, msg.actorId);
        } else {
          await repo.softDeleteTemplate(tx, p.id, p.tenantId, msg.actorId);
        }
        touched.push(p.newTemplateId);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.journeyTemplatePublished,
          action: "publish",
          resourceType: TEMPLATE_RESOURCE_TYPE,
          resourceId: p.newTemplateId,
          payload: {
            templateId: p.newTemplateId,
            templateKey: current.templateKey,
            versionNumber: p.versionNumber,
            supersededTemplateId: p.id,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, tenantId: msg.tenantId }, "publishJourneyTemplate failed");
      throw err;
    }
    await invalidateTemplate(msg.tenantId, ...touched);
  });

  queue.subscribe<{ id: string; tenantId: string; reason: string | null }>(
    COMMANDS.deprecateJourneyTemplate,
    async (msg) => {
      const p = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const current = await repo.findTemplateByIdTx(tx, p.id, p.tenantId);
        if (!current) {
          await auditOnly(tx, msg, "deprecate", TEMPLATE_RESOURCE_TYPE, p.id, "not_found");
          return;
        }
        const deprecated = await repo.markDeprecated(tx, p.id, p.tenantId, msg.actorId);
        if (!deprecated) {
          await auditOnly(tx, msg, "deprecate", TEMPLATE_RESOURCE_TYPE, p.id, "invalid_status");
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.journeyTemplateDeprecated,
          action: "deprecate",
          resourceType: TEMPLATE_RESOURCE_TYPE,
          resourceId: p.id,
          payload: {
            templateId: p.id,
            templateKey: current.templateKey,
            versionNumber: current.versionNumber,
            reason: p.reason,
          },
        });
      });
      await invalidateTemplate(msg.tenantId, p.id);
    },
  );
}
