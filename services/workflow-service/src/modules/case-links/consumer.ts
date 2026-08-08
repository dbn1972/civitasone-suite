import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { LinkType } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "workflow-case-links-consumer" });

export function registerCaseLinksConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createCaseLink, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fromCaseId: string; toCaseId: string;
      linkType: LinkType; reason?: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const result = await repo.createLinkChecked({
          id: p.id,
          tenantId: p.tenantId,
          fromCaseId: p.fromCaseId,
          toCaseId: p.toCaseId,
          linkType: p.linkType,
          reason: p.reason,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
        }, tx);
        if (!result.ok) {
          log.warn({ errors: result.errors, messageId: msg.messageId }, "createCaseLink rejected");
          return;
        }
        await enqueue(tx, {
          topic: EVENTS.caseLinkCreated, eventType: EVENTS.caseLinkCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, fromCaseId: p.fromCaseId, toCaseId: p.toCaseId, linkType: p.linkType },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "create", resourceType: "case_link", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createCaseLink failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.splitCase, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; parentCaseId: string;
      children: Array<{ title: string; caseType: string; allocation?: number; assigneeId?: string }>;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        try {
          const childIds = await repo.persistSplit({
            tenantId: p.tenantId,
            parentCaseId: p.parentCaseId,
            children: p.children,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
          }, tx);
          await enqueue(tx, {
            topic: EVENTS.caseSplit, eventType: EVENTS.caseSplit,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { parentCaseId: p.parentCaseId, childIds },
          });
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "split", resourceType: "case", resourceId: msg.messageId, outcome: "success" } });
        } catch (err) {
          if (err instanceof HttpError) {
            log.warn({ err, messageId: msg.messageId }, "splitCase rejected");
            return;
          }
          throw err;
        }
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "splitCase failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.mergeCases, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; sourceIds: string[]; targetId: string; reason: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        try {
          const merged = await repo.persistMerge({
            tenantId: p.tenantId,
            sourceIds: p.sourceIds,
            targetId: p.targetId,
            reason: p.reason,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
          }, tx);
          await enqueue(tx, {
            topic: EVENTS.casesMerged, eventType: EVENTS.casesMerged,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { targetId: p.targetId, mergedCount: merged },
          });
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "merge", resourceType: "cases", resourceId: msg.messageId, outcome: "success" } });
        } catch (err) {
          if (err instanceof HttpError) {
            log.warn({ err, messageId: msg.messageId }, "mergeCases rejected");
            return;
          }
          throw err;
        }
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "mergeCases failed");
      throw err;
    }
  });
}
