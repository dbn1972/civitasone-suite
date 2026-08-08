import { eq, and, asc, desc, ne, inArray, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { definitions, definitionNodes, definitionEdges, type DefinitionEdgeRow } from "./schema.js";
import { instances } from "../instances/schema.js";
import { evaluateCondition } from "../../shared/condition.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update">;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function findByTenant(tenantId: string, limit = 50, offset = 0) {
  return scopedRead((tx) => tx.select().from(definitions)
    .where(eq(definitions.tenantId, tenantId))
    .orderBy(desc(definitions.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function findById(id: string, tenantId: string) {
  const rows = await scopedRead((tx) => tx.select().from(definitions)
    .where(and(eq(definitions.id, id), eq(definitions.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function listNodes(definitionId: string) {
  return scopedRead((tx) => tx.select().from(definitionNodes)
    .where(eq(definitionNodes.definitionId, definitionId))
    .orderBy(asc(definitionNodes.sortOrder)));
}

export async function listEdges(definitionId: string) {
  return scopedRead((tx) => tx.select().from(definitionEdges)
    .where(eq(definitionEdges.definitionId, definitionId))
    .orderBy(asc(definitionEdges.sortOrder)));
}

/** Active definition for a code (the deployed, non-archived version). */
export async function findByCode(tenantId: string, code: string) {
  const rows = await scopedRead((tx) => tx.select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code), eq(definitions.status, "active")))
    .limit(1));
  return rows[0] ?? null;
}

export async function findByCodeTx(tx: Writer, tenantId: string, code: string) {
  const rows = await (tx as typeof db).select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code), eq(definitions.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * M1 — executable lookup for call-activity. Like findByCodeTx but also excludes
 * TEMPLATE definitions, so a call node can never instantiate a template as a
 * live child instance (templates are clone-only, never directly runnable).
 */
export async function findExecutableByCodeTx(tx: Writer, tenantId: string, code: string) {
  const rows = await (tx as typeof db).select().from(definitions)
    .where(and(
      eq(definitions.tenantId, tenantId),
      eq(definitions.code, code),
      eq(definitions.status, "active"),
      eq(definitions.isTemplate, false),
    ))
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
  /** FN-25 — superior designation for SLA breach escalation. */
  escalateToRef?: string | null | undefined;
  nodeType?: string | undefined;
  slaMinutes?: number | null | undefined;
  timerMinutes?: number | null | undefined;
  deemedApproval?: boolean | undefined;
  // Gap 1 — sub-workflow / call-activity.
  callDefinitionCode?: string | null | undefined;
  callContextMap?: Record<string, string> | null | undefined;
  // Gap 4 — auto-assignment strategy.
  assignStrategy?: string | null | undefined;
  assignRef?: string | null | undefined;
  // Visual designer position
  positionX?: number | null | undefined;
  positionY?: number | null | undefined;
  // Message/Signal events
  messageName?: string | null | undefined;
  correlationKeyExpr?: string | null | undefined;
  signalName?: string | null | undefined;
  messageTopic?: string | null | undefined;
  messagePayloadExpr?: string | null | undefined;
  // Decision tables
  decisionTableCode?: string | null | undefined;
  // Compensation
  compensationHandlerKey?: string | null | undefined;
  // Multi-instance
  multiInstanceCollection?: string | null | undefined;
  multiInstanceMode?: string | null | undefined;
  multiInstanceCompletion?: string | null | undefined;
  sortOrder?: number | undefined;
}
export interface EdgeSpec {
  fromNode: string;
  toNode: string;
  condition?: string | null | undefined;
  waypoints?: Array<{ x: number; y: number }> | null | undefined;
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
        ...(n.escalateToRef !== undefined && n.escalateToRef !== null ? { escalateToRef: n.escalateToRef } : {}),
        nodeType: n.nodeType ?? "task",
        ...(n.slaMinutes !== undefined && n.slaMinutes !== null ? { slaMinutes: n.slaMinutes } : {}),
        ...(n.timerMinutes !== undefined && n.timerMinutes !== null ? { timerMinutes: n.timerMinutes } : {}),
        ...(n.deemedApproval !== undefined ? { deemedApproval: n.deemedApproval } : {}),
        ...(n.callDefinitionCode !== undefined && n.callDefinitionCode !== null ? { callDefinitionCode: n.callDefinitionCode } : {}),
        ...(n.callContextMap !== undefined && n.callContextMap !== null ? { callContextMap: n.callContextMap } : {}),
        ...(n.assignStrategy !== undefined && n.assignStrategy !== null ? { assignStrategy: n.assignStrategy } : {}),
        ...(n.assignRef !== undefined && n.assignRef !== null ? { assignRef: n.assignRef } : {}),
        ...(n.messageName ? { messageName: n.messageName } : {}),
        ...(n.correlationKeyExpr ? { correlationKeyExpr: n.correlationKeyExpr } : {}),
        ...(n.signalName ? { signalName: n.signalName } : {}),
        ...(n.messageTopic ? { messageTopic: n.messageTopic } : {}),
        ...(n.messagePayloadExpr ? { messagePayloadExpr: n.messagePayloadExpr } : {}),
        ...(n.decisionTableCode ? { decisionTableCode: n.decisionTableCode } : {}),
        ...(n.compensationHandlerKey ? { compensationHandlerKey: n.compensationHandlerKey } : {}),
        ...(n.multiInstanceCollection ? { multiInstanceCollection: n.multiInstanceCollection } : {}),
        ...(n.multiInstanceMode ? { multiInstanceMode: n.multiInstanceMode } : {}),
        ...(n.multiInstanceCompletion ? { multiInstanceCompletion: n.multiInstanceCompletion } : {}),
        ...(n.positionX !== undefined ? { positionX: n.positionX } : {}),
        ...(n.positionY !== undefined ? { positionY: n.positionY } : {}),
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
        ...(e.waypoints !== undefined ? { waypoints: e.waypoints } : {}),
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

// ---------------------------------------------------------------------------
// Gap 7 — definition templates (platform/global) + clone-into-tenant.
// ---------------------------------------------------------------------------

/** List template definitions (is_template = true), across tenants (platform). */
export async function listTemplates(limit = 50, offset = 0) {
  return scopedRead((tx) => tx.select().from(definitions)
    .where(eq(definitions.isTemplate, true))
    .orderBy(desc(definitions.createdAt))
    .limit(limit)
    .offset(offset));
}

/** Fetch a template by id (must be a template; tenant-agnostic by design). */
export async function findTemplateById(id: string) {
  const rows = await scopedRead((tx) => tx.select().from(definitions)
    .where(and(eq(definitions.id, id), eq(definitions.isTemplate, true)))
    .limit(1));
  return rows[0] ?? null;
}

/** Raw node rows for a definition (used when cloning a template's graph). */
export async function listNodeRows(definitionId: string) {
  return scopedRead((tx) => tx.select().from(definitionNodes)
    .where(eq(definitionNodes.definitionId, definitionId))
    .orderBy(asc(definitionNodes.sortOrder)));
}

// ---------------------------------------------------------------------------
// CAP-030 — versioning: list versions, in-flight impact, rollback.
// ---------------------------------------------------------------------------

/** All versions of a definition code (any status), newest version first. */
export async function listVersionsByCode(tenantId: string, code: string) {
  return scopedRead((tx) => tx.select().from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, code)))
    .orderBy(desc(definitions.version)));
}

/**
 * CAP-030 in-flight impact: how many RUNNING (active|suspended) instances are
 * pinned to each version of a definition code. Proves version pinning — the
 * counts stay put when a new version is published, so a deploy/rollback never
 * silently re-routes live cases onto a different graph.
 */
export async function inflightByVersion(
  tenantId: string, code: string,
): Promise<Array<{ definitionId: string; version: number | null; status: string; count: number }>> {
  const defs = await listVersionsByCode(tenantId, code);
  const ids = defs.map((d) => d.id);
  if (ids.length === 0) return [];
  const rows = await scopedRead((tx) => tx.select({
    definitionId: instances.definitionId,
    version: instances.definitionVersion,
    n: sql<number>`count(*)::int`,
  }).from(instances)
    .where(and(
      eq(instances.tenantId, tenantId),
      inArray(instances.definitionId, ids),
      inArray(instances.status, ["active", "suspended"]),
    ))
    .groupBy(instances.definitionId, instances.definitionVersion));
  const byId = new Map(rows.map((r) => [r.definitionId, r]));
  return defs.map((d) => ({
    definitionId: d.id,
    version: d.version,
    status: d.status,
    count: byId.get(d.id)?.n ?? 0,
  }));
}

/**
 * CAP-030 rollback: re-activate a specific (archived/draft) version of a code
 * and archive all others. In-flight instances are UNAFFECTED — they remain
 * pinned to their own definition_id — so rollback only changes which version
 * NEW instances start on. Returns the activated row, or null if not found.
 */
export async function rollbackToVersionTx(
  tx: Writer, tenantId: string, code: string, version: number, actorId: string,
) {
  const target = await findByCodeVersionTx(tx, tenantId, code, version);
  if (!target) return null;
  await (tx as typeof db).update(definitions)
    .set({ status: "active", updatedBy: actorId, updatedAt: new Date() })
    .where(eq(definitions.id, target.id));
  await archiveOtherVersionsTx(tx, tenantId, code, target.id);
  return { ...target, status: "active" };
}
