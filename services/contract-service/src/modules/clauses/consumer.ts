import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { clauseLibrary } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { validateBody, validateMergeFields } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

async function audit(tx: any, msg: any, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType: "clause", resourceId, outcome: "success" },
  });
}

export function registerClauseConsumers(q: Queue): void {
  q.subscribe(COMMANDS.clauseCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const body = p.body as string;
      const mergeFields = (p.mergeFields ?? []) as string[];

      validateBody(body);
      validateMergeFields(mergeFields);

      await tx.insert(clauseLibrary).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        title: p.title as string,
        category: p.category as string,
        jurisdiction: p.jurisdiction as string,
        body,
        mergeFields,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.clauseCreated, eventType: EVENTS.clauseCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id as string, tenantId: msg.tenantId, title: p.title as string, category: p.category as string },
      });
      await audit(tx, msg, "create", p.id as string);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "clause", "list"));
  });

  q.subscribe(COMMANDS.clauseUpdate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const id = p.id as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const tenantId = msg.tenantId;
      const currentVersion = p.version as number;

      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: currentVersion + 1,
      };

      if (p.body !== undefined) {
        validateBody(p.body as string);
        updates.body = p.body;
      }
      if (p.mergeFields !== undefined) {
        validateMergeFields(p.mergeFields);
        updates.mergeFields = p.mergeFields;
      }
      if (p.title !== undefined) updates.title = p.title;
      if (p.category !== undefined) updates.category = p.category;
      if (p.jurisdiction !== undefined) updates.jurisdiction = p.jurisdiction;

      const [updated] = await tx
        .update(clauseLibrary)
        .set(updates as any)
        .where(
          and(
            eq(clauseLibrary.id, id),
            eq(clauseLibrary.tenantId, tenantId),
            eq(clauseLibrary.version, currentVersion),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx, {
        topic: EVENTS.clauseUpdated, eventType: EVENTS.clauseUpdated,
        tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, tenantId, version: currentVersion + 1 },
      });
      await audit(tx, msg, "update", id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "clause", id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "clause", "list"));
  });

  q.subscribe(COMMANDS.clauseArchive, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const id = p.id as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const tenantId = msg.tenantId;
      const currentVersion = p.version as number;

      const [archived] = await tx
        .update(clauseLibrary)
        .set({
          status: "archived",
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: currentVersion + 1,
        })
        .where(
          and(
            eq(clauseLibrary.id, id),
            eq(clauseLibrary.tenantId, tenantId),
            eq(clauseLibrary.version, currentVersion),
          ),
        )
        .returning();

      if (!archived) return;

      await enqueue(tx, {
        topic: EVENTS.clauseArchived, eventType: EVENTS.clauseArchived,
        tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, tenantId },
      });
      await audit(tx, msg, "archive", id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "clause", id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "clause", "list"));
  });
}
