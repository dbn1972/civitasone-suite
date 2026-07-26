import { randomUUID } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { checklistTemplates, checklistInstances, type ChecklistTemplateRow, type ChecklistInstanceRow } from "./schema.js";
import { instantiate, type ChecklistItem } from "./domain.js";

export async function listTemplates(tenantId: string): Promise<ChecklistTemplateRow[]> {
  return scopedRead((tx) => tx.select().from(checklistTemplates)
    .where(eq(checklistTemplates.tenantId, tenantId)).orderBy(asc(checklistTemplates.code)));
}
export async function findTemplate(tenantId: string, id: string): Promise<ChecklistTemplateRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(checklistTemplates)
    .where(and(eq(checklistTemplates.tenantId, tenantId), eq(checklistTemplates.id, id))).limit(1));
  return rows[0];
}

export async function upsertTemplate(input: { tenantId: string; code: string; name: string; items: Array<{ key: string; label: string; required?: boolean }>; actorId: string }): Promise<ChecklistTemplateRow> {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const tplRows = await tx.insert(checklistTemplates).values({
      id, tenantId: input.tenantId, code: input.code, name: input.name, items: input.items, createdBy: input.actorId,
    }).onConflictDoUpdate({
      target: [checklistTemplates.tenantId, checklistTemplates.code],
      set: { name: input.name, items: input.items, updatedAt: new Date() },
    }).returning();
    return tplRows[0]!;
  });
}

export async function findInstance(tenantId: string, id: string): Promise<ChecklistInstanceRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(checklistInstances)
    .where(and(eq(checklistInstances.tenantId, tenantId), eq(checklistInstances.id, id))).limit(1));
  return rows[0];
}
export async function listInstancesForEntity(tenantId: string, entityType: string, entityId: string): Promise<ChecklistInstanceRow[]> {
  return scopedRead((tx) => tx.select().from(checklistInstances)
    .where(and(eq(checklistInstances.tenantId, tenantId), eq(checklistInstances.entityType, entityType), eq(checklistInstances.entityId, entityId)))
    .orderBy(asc(checklistInstances.createdAt)));
}

/** Instantiate a template against an entity (fresh unchecked items). */
export async function createInstance(input: { tenantId: string; templateId: string; entityType: string; entityId: string; actorId: string }): Promise<ChecklistInstanceRow | null> {
  return db.transaction(async (tx) => {
    const tpl = (await tx.select().from(checklistTemplates)
      .where(and(eq(checklistTemplates.tenantId, input.tenantId), eq(checklistTemplates.id, input.templateId))).limit(1))[0];
    if (!tpl) return null;
    const items = instantiate(tpl.items);
    const instRows = await tx.insert(checklistInstances).values({
      id: randomUUID(), tenantId: input.tenantId, templateId: input.templateId,
      entityType: input.entityType, entityId: input.entityId, items, createdBy: input.actorId,
    }).returning();
    return instRows[0]!;
  });
}

/** Persist an updated item set for an instance (optimistic-safe: full replace). */
export async function saveItems(tenantId: string, id: string, items: ChecklistItem[]): Promise<ChecklistInstanceRow | null> {
  return db.transaction(async (tx) => {
    const res = await tx.update(checklistInstances)
      .set({ items, updatedAt: new Date() })
      .where(and(eq(checklistInstances.tenantId, tenantId), eq(checklistInstances.id, id)))
      .returning();
    return res[0] ?? null;
  });
}
