import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "workflow-comments-consumer" });

export function registerCommentsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.addComment, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; entityType: string; entityId: string;
      parentCommentId?: string; body: string; visibility: "internal" | "external";
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        try {
          await repo.add({
            id: p.id,
            tenantId: p.tenantId,
            entityType: p.entityType,
            entityId: p.entityId,
            parentCommentId: p.parentCommentId,
            body: p.body,
            visibility: p.visibility,
            actorId: msg.actorId,
          }, tx);
        } catch (err) {
          if (err instanceof Error && err.message === "PARENT_NOT_FOUND") {
            log.warn({ messageId: msg.messageId }, "addComment parent missing");
            return;
          }
          throw err;
        }
        await enqueue(tx, {
          topic: EVENTS.commentAdded, eventType: EVENTS.commentAdded,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, entityType: p.entityType, entityId: p.entityId },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "process", resourceType: "comments", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "addComment failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.editComment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; body: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const updated = await repo.edit(p.tenantId, p.id, p.body, msg.actorId, tx);
        if (!updated) return;
        await enqueue(tx, {
          topic: EVENTS.commentEdited, eventType: EVENTS.commentEdited,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "process", resourceType: "comments", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "editComment failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteComment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ok = await repo.softDelete(p.tenantId, p.id, msg.actorId, tx);
        if (!ok) return;
        await enqueue(tx, {
          topic: EVENTS.commentDeleted, eventType: EVENTS.commentDeleted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "delete", resourceType: "comment", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteComment failed");
      throw err;
    }
  });
}
