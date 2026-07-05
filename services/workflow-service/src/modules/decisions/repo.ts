import { eq, and, ne, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { decisionTables, type DecisionTableInsert } from "./schema.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update">;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Active version of a decision table by code. */
export async function findByCode(tenantId: string, code: string) {
  const rows = await db.select().from(decisionTables)
    .where(and(
      eq(decisionTables.tenantId, tenantId),
      eq(decisionTables.code, code),
      eq(decisionTables.status, "active"),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/** Active version of a decision table by code (transactional). */
export async function findByCodeTx(tx: Writer, tenantId: string, code: string) {
  const rows = await (tx as typeof db).select().from(decisionTables)
    .where(and(
      eq(decisionTables.tenantId, tenantId),
      eq(decisionTables.code, code),
      eq(decisionTables.status, "active"),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/** Find a decision table by id + tenant. */
export async function findById(id: string, tenantId: string) {
  const rows = await db.select().from(decisionTables)
    .where(and(eq(decisionTables.id, id), eq(decisionTables.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** List decision tables for a tenant (paginated). */
export async function listByTenant(tenantId: string, limit = 50, offset = 0) {
  return db.select().from(decisionTables)
    .where(eq(decisionTables.tenantId, tenantId))
    .orderBy(desc(decisionTables.createdAt))
    .limit(limit)
    .offset(offset);
}

// ---------------------------------------------------------------------------
// Writes (transactional)
// ---------------------------------------------------------------------------

/** Insert a new decision table row. */
export async function insertDecisionTable(tx: Writer, row: DecisionTableInsert) {
  const rows = await tx.insert(decisionTables).values(row).returning();
  return rows[0]!;
}

/** Partial update of a decision table by id. */
export async function updateDecisionTable(
  tx: Writer,
  id: string,
  patch: Partial<Pick<DecisionTableInsert, "name" | "hitPolicy" | "inputs" | "outputs" | "rules" | "status" | "updatedBy">>,
) {
  const rows = await tx.update(decisionTables)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(decisionTables.id, id))
    .returning();
  return rows[0] ?? null;
}

/** Deploy: set status='active' on the given id and archive others with same code. */
export async function deployVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
) {
  await tx.update(decisionTables)
    .set({ status: "active", updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(decisionTables.id, id), eq(decisionTables.tenantId, tenantId)));

  // Archive other versions of the same code
  const rows = await (tx as typeof db).select({ code: decisionTables.code }).from(decisionTables)
    .where(and(eq(decisionTables.id, id), eq(decisionTables.tenantId, tenantId)))
    .limit(1);
  const code = rows[0]?.code;
  if (code) {
    await archiveOthers(tx, tenantId, code, id);
  }
}

/** Archive all other versions of a decision table code (except keepId). */
export async function archiveOthers(
  tx: Writer,
  tenantId: string,
  code: string,
  keepId: string,
) {
  await tx.update(decisionTables)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(
      eq(decisionTables.tenantId, tenantId),
      eq(decisionTables.code, code),
      ne(decisionTables.id, keepId),
    ));
}
