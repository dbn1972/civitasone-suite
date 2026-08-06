/**
 * Segment taxonomy consumers (G5).
 *
 * Every handler follows the service's CQRS contract in this exact order:
 *   markProcessed FIRST → write → enqueue outbox event + audit event → cache invalidate.
 *
 * A refused transition (stale version, canonical row, wrong status) is not an error:
 * the guarded UPDATE matches nothing, and the handler records an audit event with a
 * non-success outcome so the refusal is visible in the trail instead of vanishing.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { SegmentGovernance } from "./schema.js";

const log = pino({ name: "crm-segments-consumer" });
const RESOURCE = repo.RESOURCE;
const SETTINGS_RESOURCE = repo.SETTINGS_RESOURCE;

export interface CreateSegmentPayload {
  tenantId: string;
  segmentCode: string;
  displayName: string;
  description: string | null;
  governance: SegmentGovernance;
  priorityProducts: string[];
  primaryChannels: string[];
}

export interface UpdateSegmentPayload {
  tenantId: string;
  segmentCode: string;
  displayName?: string;
  description?: string | null;
  priorityProducts?: string[];
  primaryChannels?: string[];
  version: number;
}

export interface SegmentCodePayload {
  tenantId: string;
  segmentCode: string;
}

export interface SetSegmentSettingsPayload {
  tenantId: string;
  enforceSegmentCatalogue: boolean;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as RequestContext;
}

async function invalidate(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE);
}

export function registerSegmentConsumers(queue: Queue): void {
  queue.subscribe<CreateSegmentPayload>(COMMANDS.createSegmentDefinition, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // ON CONFLICT DO NOTHING on (tenant_id, segment_code): a redelivery whose
        // inbox row was lost converges on the existing row instead of failing.
        await repo.insert(tx, {
          tenantId: p.tenantId,
          segmentCode: p.segmentCode,
          displayName: p.displayName,
          description: p.description,
          governance: p.governance,
          priorityProducts: p.priorityProducts,
          primaryChannels: p.primaryChannels,
          status: "draft",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.segmentDefinitionCreated,
          action: "create",
          resourceType: RESOURCE,
          resourceId: p.segmentCode,
          payload: {
            segmentCode: p.segmentCode,
            governance: p.governance,
            status: "draft",
            priorityProducts: p.priorityProducts,
            primaryChannels: p.primaryChannels,
          },
        });
      });
      await invalidate(p.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createSegmentDefinition failed");
      throw err;
    }
  });

  queue.subscribe<UpdateSegmentPayload>(COMMANDS.updateSegmentDefinition, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const updated = await repo.updateWithVersion(
          tx,
          p.tenantId,
          p.segmentCode,
          p.version,
          {
            ...(p.displayName !== undefined ? { displayName: p.displayName } : {}),
            ...(p.description !== undefined ? { description: p.description } : {}),
            ...(p.priorityProducts !== undefined ? { priorityProducts: p.priorityProducts } : {}),
            ...(p.primaryChannels !== undefined ? { primaryChannels: p.primaryChannels } : {}),
          },
          msg.actorId,
        );
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.segmentDefinitionUpdated,
          action: "update",
          resourceType: RESOURCE,
          resourceId: p.segmentCode,
          payload: { segmentCode: p.segmentCode, applied: updated },
          ...(updated ? {} : { outcome: "version_conflict" }),
        });
      });
      await invalidate(p.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateSegmentDefinition failed");
      throw err;
    }
  });

  queue.subscribe<SegmentCodePayload>(COMMANDS.publishSegmentDefinition, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const applied = await repo.publish(tx, p.tenantId, p.segmentCode, msg.actorId);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.segmentDefinitionPublished,
          action: "publish",
          resourceType: RESOURCE,
          resourceId: p.segmentCode,
          payload: { segmentCode: p.segmentCode, applied },
          ...(applied ? {} : { outcome: "transition_refused" }),
        });
      });
      await invalidate(p.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "publishSegmentDefinition failed");
      throw err;
    }
  });

  queue.subscribe<SegmentCodePayload>(COMMANDS.deprecateSegmentDefinition, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const applied = await repo.deprecate(tx, p.tenantId, p.segmentCode, msg.actorId);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.segmentDefinitionDeprecated,
          action: "deprecate",
          resourceType: RESOURCE,
          resourceId: p.segmentCode,
          payload: { segmentCode: p.segmentCode, applied },
          ...(applied ? {} : { outcome: "transition_refused" }),
        });
      });
      await invalidate(p.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deprecateSegmentDefinition failed");
      throw err;
    }
  });

  queue.subscribe<SegmentCodePayload>(COMMANDS.deleteSegmentDefinition, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const applied = await repo.softDelete(tx, p.tenantId, p.segmentCode, msg.actorId);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.segmentDefinitionDeleted,
          action: "delete",
          resourceType: RESOURCE,
          resourceId: p.segmentCode,
          payload: { segmentCode: p.segmentCode, applied },
          ...(applied ? {} : { outcome: "transition_refused" }),
        });
      });
      await invalidate(p.tenantId);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteSegmentDefinition failed");
      throw err;
    }
  });

  queue.subscribe<SetSegmentSettingsPayload>(COMMANDS.setSegmentSettings, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsertSettings(tx, p.tenantId, p.enforceSegmentCatalogue, msg.actorId);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.segmentSettingsUpdated,
          action: "update",
          resourceType: SETTINGS_RESOURCE,
          resourceId: p.tenantId,
          payload: { enforceSegmentCatalogue: p.enforceSegmentCatalogue },
        });
      });
      await cache.invalidateResource(p.tenantId, SETTINGS_RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "setSegmentSettings failed");
      throw err;
    }
  });
}
