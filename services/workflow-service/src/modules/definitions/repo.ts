import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { definitions, definitionNodes } from "./schema.js";

export type Writer = Pick<typeof db, "select">;

export async function findByTenant(tenantId: string, limit = 50, offset = 0) {
  return db.select().from(definitions)
    .where(eq(definitions.tenantId, tenantId))
    .orderBy(desc(definitions.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function findByCode(tenantId: string, code: string) {
  const rows = await db.select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code), eq(definitions.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function findFirstNode(definitionId: string) {
  const rows = await db.select().from(definitionNodes)
    .where(eq(definitionNodes.definitionId, definitionId))
    .orderBy(asc(definitionNodes.sortOrder))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByCodeTx(tx: Writer, tenantId: string, code: string) {
  const rows = await (tx as typeof db).select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findFirstNodeTx(tx: Writer, definitionId: string) {
  const rows = await (tx as typeof db).select().from(definitionNodes)
    .where(eq(definitionNodes.definitionId, definitionId))
    .orderBy(asc(definitionNodes.sortOrder))
    .limit(1);
  return rows[0] ?? null;
}

export async function findNodeByKeyTx(tx: Writer, definitionId: string, nodeKey: string) {
  const rows = await (tx as typeof db).select().from(definitionNodes)
    .where(and(eq(definitionNodes.definitionId, definitionId), eq(definitionNodes.nodeKey, nodeKey)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findNextNodeTx(tx: Writer, definitionId: string, currentNodeKey: string) {
  const current = await findNodeByKeyTx(tx, definitionId, currentNodeKey);
  if (!current) return null;
  const rows = await (tx as typeof db).select().from(definitionNodes)
    .where(and(
      eq(definitionNodes.definitionId, definitionId),
      eq(definitionNodes.sortOrder, current.sortOrder + 1),
    ))
    .limit(1);
  return rows[0] ?? null;
}
