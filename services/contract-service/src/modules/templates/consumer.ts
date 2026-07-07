import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { contractTemplates, templateClauses } from "./schema.js";
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

async function audit(tx: any, msg: any, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType: "template", resourceId, outcome: "success" },
  });
}

export function registerTemplateConsumers(q: Queue): void {
  q.subscribe(COMMANDS.templateCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(contractTemplates).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        name: p.name as string,
        description: (p.description as string) ?? "",
        status: "draft",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.templateCreated, eventType: EVENTS.templateCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id as string, tenantId: msg.tenantId, name: p.name as string },
      });
      await audit(tx, msg, "create", p.id as string);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "template", "list"));
  });

  q.subscribe(COMMANDS.templateUpdate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const id = p.id as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const currentVersion = p.version as number;
      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: currentVersion + 1,
      };

      if (p.name !== undefined) updates.name = p.name;
      if (p.description !== undefined) updates.description = p.description;
      if (p.status !== undefined) updates.status = p.status;

      const [updated] = await tx
        .update(contractTemplates)
        .set(updates as any)
        .where(
          and(
            eq(contractTemplates.id, id),
            eq(contractTemplates.tenantId, msg.tenantId),
            eq(contractTemplates.version, currentVersion),
          ),
        )
        .returning();

      if (!updated) return;

      await enqueue(tx, {
        topic: EVENTS.templateUpdated, eventType: EVENTS.templateUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, tenantId: msg.tenantId, version: currentVersion + 1 },
      });
      await audit(tx, msg, "update", id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "template", id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "template", "list"));
  });

  q.subscribe(COMMANDS.templateDelete, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const id = p.id as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const currentVersion = p.version as number;

      const [archived] = await tx
        .update(contractTemplates)
        .set({
          status: "archived",
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: currentVersion + 1,
        })
        .where(
          and(
            eq(contractTemplates.id, id),
            eq(contractTemplates.tenantId, msg.tenantId),
            eq(contractTemplates.version, currentVersion),
          ),
        )
        .returning();

      if (!archived) return;

      await enqueue(tx, {
        topic: EVENTS.templateArchived, eventType: EVENTS.templateArchived,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, tenantId: msg.tenantId },
      });
      await audit(tx, msg, "archive", id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "template", id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "template", "list"));
  });

  q.subscribe(COMMANDS.templateClauseAdd, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(templateClauses).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        templateId: p.templateId as string,
        clauseId: p.clauseId as string,
        rank: p.rank as number,
        conditionType: (p.conditionType as string) ?? "always",
        conditionField: (p.conditionField as string | null) ?? null,
        conditionOperator: (p.conditionOperator as string | null) ?? null,
        conditionValue: (p.conditionValue as string | null) ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await audit(tx, msg, "add_clause", p.id as string);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "template", p.templateId as string));
  });

  q.subscribe(COMMANDS.templateClauseUpdate, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const id = p.id as string;
    const templateId = p.templateId as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      };

      if (p.rank !== undefined) updates.rank = p.rank;
      if (p.conditionType !== undefined) updates.conditionType = p.conditionType;
      if (p.conditionField !== undefined) updates.conditionField = p.conditionField;
      if (p.conditionOperator !== undefined) updates.conditionOperator = p.conditionOperator;
      if (p.conditionValue !== undefined) updates.conditionValue = p.conditionValue;

      await tx
        .update(templateClauses)
        .set(updates as any)
        .where(
          and(
            eq(templateClauses.id, id),
            eq(templateClauses.templateId, templateId),
            eq(templateClauses.tenantId, msg.tenantId),
          ),
        );

      await audit(tx, msg, "update_clause", id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "template", templateId));
  });

  q.subscribe(COMMANDS.templateClauseRemove, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const id = p.id as string;
    const templateId = p.templateId as string;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx
        .delete(templateClauses)
        .where(
          and(
            eq(templateClauses.id, id),
            eq(templateClauses.templateId, templateId),
            eq(templateClauses.tenantId, msg.tenantId),
          ),
        );

      await audit(tx, msg, "remove_clause", id);
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "template", templateId));
  });
}
