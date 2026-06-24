import { eq, and, asc, desc, ne } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { definitions, definitionNodes, definitionEdges, type DefinitionEdgeRow } from "./schema.js";
import { evaluateCondition } from "../../shared/condition.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update">;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function findByTenant(tenantId: string, limit = 50, offset = 0) {
  return db.select().from(definitions)
    .where(eq(definitions.tenantId, tenantId))
    .orderBy(desc(definitions.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function findById(id: string, tenantId: string) {
  const rows = await db.select().from(definitions)
    .where(and(eq(definitions.id, id), eq(definitions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listNodes(definitionId: string) {
  return db.select().from(definitionNodes)
    .where(eq(definitionNodes.definitionId, definitionId))
    .orderBy(asc(definitionNodes.sortOrder));
}

export async function listEdges(definitionId: string) {
  return db.select().from(definitionEdges)
    .where(eq(definitionEdges.definitionId, definitionId))
    .orderBy(asc(definitionEdges.sortOrder));
}

/** Active definition for a code (the deployed, non-archived version). */
export async function findByCode(tenantId: string, code: string) {
  const rows = await db.select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code), eq(definitions.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByCodeTx(tx: Writer, tenantId: string, code: string) {
  const rows = await (tx as typeof db).select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code), eq(definitions.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

/** P1-4 — a specific version of a definition code (any status), for migration. */
export async function findByCodeVersionTx(tx: Writer, tenantId: string, code: string, version: number) {
  const rows = await (tx as typeof db).select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code), eq(definitions.version, version)))
    .limit(1);
  return rows[0] ?? null;
}

/** P1-4 — node keys present in a definition (for migration remap validation). */
export async function listNodeKeysTx(tx: Writer, definitionId: string): Promise<string[]> {
  const rows = await (tx as typeof db).select({ nodeKey: definitionNodes.nodeKey }).from(definitionNodes)
    .where(eq(definitionNodes.definitionId, definitionId));
  return rows.map((r) => r.nodeKey);
}

/** Lowest sort_order node = the start node. */
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

export async function findEdgesFromTx(tx: Writer, definitionId: string, fromNode: string): Promise<DefinitionEdgeRow[]> {
  return (tx as typeof db).select().from(definitionEdges)
    .where(and(eq(definitionEdges.definitionId, definitionId), eq(definitionEdges.fromNode, fromNode)))
    .orderBy(asc(definitionEdges.sortOrder));
}

export async function findEdgesToTx(tx: Writer, definitionId: string, toNode: string): Promise<DefinitionEdgeRow[]> {
  return (tx as typeof db).select().from(definitionEdges)
    .where(and(eq(definitionEdges.definitionId, definitionId), eq(definitionEdges.toNode, toNode)))
    .orderBy(asc(definitionEdges.sortOrder));
}

/**
 * Edge-driven successor resolution. Returns ALL target node keys whose edge
 * condition evaluates true against the instance context. For an XOR branch the
 * first matching edge wins (caller takes [0]); for a split node every matching
 * edge fires (caller spawns a task per target).
 */
export async function resolveNextNodesTx(
  tx: Writer,
  definitionId: string,
  fromNode: string,
  context: Record<string, unknown>,
): Promise<string[]> {
  const edges = await findEdgesFromTx(tx, definitionId, fromNode);
  return edges.filter((e) => evaluateCondition(e.condition, context)).map((e) => e.toNode);
}

// ---------------------------------------------------------------------------
// Writes (transactional create + versioning)
// ---------------------------------------------------------------------------
export interface NodeSpec {
  nodeKey: string;
  name: string;
  roleRef?: string | null | undefined;
  nodeType?: string | undefined;
  slaMinutes?: number | null | undefined;
  timerMinutes?: number | null | undefined;
  deemedApproval?: boolean | undefined;
  sortOrder?: number | undefined;
}
export interface EdgeSpec {
  fromNode: string;
  toNode: string;
  condition?: string | null | undefined;
  sortOrder?: number | undefined;
}

/** Insert nodes + edges for a definition inside a transaction. */
export async function insertGraphTx(
  tx: Writer,
  definitionId: string,
  nodes: NodeSpec[],
  edges: EdgeSpec[],
): Promise<void> {
  if (nodes.length) {
    await tx.insert(definitionNodes).values(
      nodes.map((n, i) => ({
        definitionId,
        nodeKey: n.nodeKey,
        name: n.name,
        ...(n.roleRef !== undefined && n.roleRef !== null ? { roleRef: n.roleRef } : {}),
        nodeType: n.nodeType ?? "task",
        ...(n.slaMinutes !== undefined && n.slaMinutes !== null ? { slaMinutes: n.slaMinutes } : {}),
        ...(n.timerMinutes !== undefined && n.timerMinutes !== null ? { timerMinutes: n.timerMinutes } : {}),
        ...(n.deemedApproval !== undefined ? { deemedApproval: n.deemedApproval } : {}),
        sortOrder: n.sortOrder ?? i + 1,
      })),
    );
  }
  if (edges.length) {
    await tx.insert(definitionEdges).values(
      edges.map((e, i) => ({
        definitionId,
        fromNode: e.fromNode,
        toNode: e.toNode,
        ...(e.condition !== undefined && e.condition !== null ? { condition: e.condition } : {}),
        sortOrder: e.sortOrder ?? i + 1,
      })),
    );
  }
}

/** Latest version row for a code regardless of status (for versioning). */
export async function findLatestVersionTx(tx: Writer, tenantId: string, code: string) {
  const rows = await (tx as typeof db).select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code)))
    .orderBy(desc(definitions.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function archiveOtherVersionsTx(
  tx: Writer,
  tenantId: string,
  code: string,
  keepId: string,
): Promise<void> {
  await tx.update(definitions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(
      eq(definitions.tenantId, tenantId),
      eq(definitions.code, code),
      ne(definitions.id, keepId),
    ));
}
