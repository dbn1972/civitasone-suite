import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  vigilanceCases, vigilanceEvidence, vigilanceActions,
  type VigilanceCaseRow, type VigilanceCaseInsert,
  type VigilanceEvidenceRow, type VigilanceActionRow, type VigilanceActionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── cases (reads wrapped in a tx so the tenant GUC is injected) ─────────────
export async function listVigilanceCases(tenantId: string, limit = 50, offset = 0): Promise<VigilanceCaseRow[]> {
  return db.transaction((tx) => tx.select().from(vigilanceCases)
    .where(eq(vigilanceCases.tenantId, tenantId))
    .orderBy(desc(vigilanceCases.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function listVigilanceCasesCount(tenantId: string): Promise<number> {
  const rows = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(vigilanceCases)
    .where(eq(vigilanceCases.tenantId, tenantId)));
  return rows[0]?.count ?? 0;
}

export async function findVigilanceCaseById(id: string, tenantId: string): Promise<VigilanceCaseRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(vigilanceCases)
    .where(and(eq(vigilanceCases.id, id), eq(vigilanceCases.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findByIdTx(tx: Writer, id: string, tenantId: string): Promise<VigilanceCaseRow | null> {
  const rows = await (tx as typeof db).select().from(vigilanceCases)
    .where(and(eq(vigilanceCases.id, id), eq(vigilanceCases.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertCase(tx: Writer, row: VigilanceCaseInsert): Promise<void> {
  await tx.insert(vigilanceCases).values(row);
}

export async function updateCaseVersioned(
  tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<VigilanceCaseInsert>,
): Promise<number> {
  const res = await (tx as typeof db).update(vigilanceCases)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(vigilanceCases.id, id), eq(vigilanceCases.tenantId, tenantId), eq(vigilanceCases.version, expectedVersion)))
    .returning({ id: vigilanceCases.id });
  return res.length;
}

// ── evidence ────────────────────────────────────────────────────────────────
export async function insertEvidence(tx: Writer, row: typeof vigilanceEvidence.$inferInsert): Promise<void> {
  await tx.insert(vigilanceEvidence).values(row);
}

export async function listEvidence(caseId: string, tenantId: string): Promise<VigilanceEvidenceRow[]> {
  return db.transaction((tx) => tx.select().from(vigilanceEvidence)
    .where(and(eq(vigilanceEvidence.caseId, caseId), eq(vigilanceEvidence.tenantId, tenantId)))
    .orderBy(desc(vigilanceEvidence.collectedAt)));
}

// ── actions (maker-checker) ─────────────────────────────────────────────────
export async function insertAction(tx: Writer, row: VigilanceActionInsert): Promise<void> {
  await tx.insert(vigilanceActions).values(row);
}

export async function findActionByIdTx(tx: Writer, id: string, tenantId: string): Promise<VigilanceActionRow | null> {
  const rows = await (tx as typeof db).select().from(vigilanceActions)
    .where(and(eq(vigilanceActions.id, id), eq(vigilanceActions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updateActionVersioned(
  tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<VigilanceActionInsert>,
): Promise<number> {
  const res = await (tx as typeof db).update(vigilanceActions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(vigilanceActions.id, id), eq(vigilanceActions.tenantId, tenantId), eq(vigilanceActions.version, expectedVersion)))
    .returning({ id: vigilanceActions.id });
  return res.length;
}

export async function listActions(caseId: string, tenantId: string): Promise<VigilanceActionRow[]> {
  return db.transaction((tx) => tx.select().from(vigilanceActions)
    .where(and(eq(vigilanceActions.caseId, caseId), eq(vigilanceActions.tenantId, tenantId)))
    .orderBy(desc(vigilanceActions.createdAt)));
}
