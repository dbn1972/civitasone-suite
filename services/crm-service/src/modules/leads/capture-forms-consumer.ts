/**
 * Consumer for the LM-002 public lead-capture form registry.
 *
 * Same shape as field-rules-consumer.ts: one transaction per message, `markProcessed`
 * FIRST so a redelivery is a no-op, then the write, then the event + audit through the
 * outbox so the trail commits with the row. Errors are logged via Pino and rethrown so
 * the bus can retry and eventually dead-letter — swallowing here would turn a failed
 * write into a silent 202.
 *
 * What these three handlers govern is a PUBLIC, UNAUTHENTICATED endpoint, so the
 * emitted events deliberately carry NO form key: it is a bearer secret in a URL, and
 * broadcasting it to every downstream consumer (and into their logs) would defeat
 * generating it server-side in the first place.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./capture-forms-repo.js";

const log = pino({ name: "crm-lead-capture-forms-consumer" });

/** The read path builds its cache key from this same constant. */
const RESOURCE = repo.RESOURCE;

export interface CreateLeadCaptureFormPayload {
  id: string;
  tenantId: string;
  formKey: string;
  name: string;
  enabled: boolean;
  requireConsent: boolean;
  allowedOrigins: string[];
  defaultLeadSource?: string;
  campaignId?: string;
  maxPerMinute: number;
  createdBy: string;
  updatedBy: string;
}

/** Only the fields the admin actually sent. `formKey` is absent by design — rotating a
 *  key is a create + delete, so the old URL stops working deliberately rather than a
 *  live form silently changing address. */
export interface UpdateLeadCaptureFormPayload {
  id: string;
  tenantId: string;
  changed: {
    name?: string;
    enabled?: boolean;
    requireConsent?: boolean;
    allowedOrigins?: string[];
    defaultLeadSource?: string;
    campaignId?: string;
    maxPerMinute?: number;
  };
  updatedBy: string;
}

export interface DeleteLeadCaptureFormPayload {
  id: string;
  tenantId: string;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

export function registerLeadCaptureFormConsumers(queue: Queue): void {
  queue.subscribe<CreateLeadCaptureFormPayload>(COMMANDS.createLeadCaptureForm, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insert(tx, {
          id: p.id,
          tenantId: p.tenantId,
          formKey: p.formKey,
          name: p.name,
          enabled: p.enabled,
          requireConsent: p.requireConsent,
          allowedOrigins: p.allowedOrigins,
          ...(p.defaultLeadSource !== undefined ? { defaultLeadSource: p.defaultLeadSource } : {}),
          ...(p.campaignId !== undefined ? { campaignId: p.campaignId } : {}),
          maxPerMinute: p.maxPerMinute,
          createdBy: p.createdBy,
          updatedBy: p.updatedBy,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadCaptureFormCreated,
          action: "create",
          resourceType: RESOURCE,
          resourceId: p.id,
          // No formKey. See the file header.
          payload: {
            formId: p.id,
            name: p.name,
            enabled: p.enabled,
            requireConsent: p.requireConsent,
            maxPerMinute: p.maxPerMinute,
          },
        });
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createLeadCaptureForm failed");
      throw err;
    }
  });

  queue.subscribe<UpdateLeadCaptureFormPayload>(COMMANDS.updateLeadCaptureForm, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Guarded UPDATE: false means the form was deleted between the route's 404 check
        // and this handler running. Emitting a "form updated" event for a write that
        // never happened would leave downstream consumers describing a form that no
        // longer exists, so the event is skipped and the outcome recorded in audit only.
        const applied = await repo.update(tx, p.tenantId, p.id, p.changed, p.updatedBy);
        if (!applied) {
          log.warn({ messageId: msg.messageId, formId: p.id }, "capture form vanished before update");
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadCaptureFormUpdated,
          action: "update",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { formId: p.id, changed: p.changed },
        });
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateLeadCaptureForm failed");
      throw err;
    }
  });

  queue.subscribe<DeleteLeadCaptureFormPayload>(COMMANDS.deleteLeadCaptureForm, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const removed = await repo.remove(tx, p.tenantId, p.id);
        if (!removed) {
          // Already gone. Idempotent by nature — nothing to emit, nothing to fix.
          log.warn({ messageId: msg.messageId, formId: p.id }, "capture form already deleted");
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadCaptureFormDeleted,
          action: "delete",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { formId: p.id },
        });
      });
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteLeadCaptureForm failed");
      throw err;
    }
  });
}
