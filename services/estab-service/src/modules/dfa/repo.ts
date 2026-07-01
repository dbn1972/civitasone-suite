import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabDfa, estabDfaVersion } from "./schema.js";
import type { DfaRow, DfaInsert, DfaVersionRow, DfaVersionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Allocate a GAPLESS DFA serial per (tenant, communication-type, year) from
 * files.estab_doc_seq — atomic INSERT … ON CONFLICT DO UPDATE … RETURNING, so
 * concurrent drafts never collide or skip (replaces the old Math.random()).
 */
export async function allocateDfaSeq(tx: Exec, tenantId: string, communicationType: string, year: number): Promise<number> {
  const series = `dfa:${communicationType}`;
  const rows = await tx.execute(sql`
    INSERT INTO files.estab_doc_seq (tenant_id, series, year, last_seq)
    VALUES (${tenantId}::uuid, ${series}, ${year}, 1)
    ON CONFLICT (tenant_id, series, year)
    DO UPDATE SET last_seq = files.estab_doc_seq.last_seq + 1
    RETURNING last_seq
  `);
  return Number((rows as unknown as Array<{ last_seq: number }>)[0]?.last_seq ?? 1);
}

export async function findDfaById(id: string, tenantId: string): Promise<DfaRow | null> {
  const rows = await db.select().from(estabDfa)
    .where(and(eq(estabDfa.id, id), eq(estabDfa.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listDfa(
  tenantId: string,
  filter: { status?: string | undefined; fileId?: string | undefined },
  limit: number,
): Promise<DfaRow[]> {
  const rows = await db.select().from(estabDfa)
    .where(eq(estabDfa.tenantId, tenantId))
    .orderBy(desc(estabDfa.createdAt))
    .limit(limit);
  return rows
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .filter((r) => (filter.fileId ? r.fileId === filter.fileId : true));
}

export async function insertDfa(tx: Writer, row: DfaInsert): Promise<void> {
  await tx.insert(estabDfa).values(row);
}

export async function updateDfa(tx: Writer, id: string, patch: Partial<DfaInsert>): Promise<void> {
  await tx.update(estabDfa).set({ ...patch, updatedAt: new Date() }).where(eq(estabDfa.id, id));
}

/** Snapshot a DFA revision into the version history (R3 draft versioning). */
export async function insertDfaVersion(tx: Writer, row: DfaVersionInsert): Promise<void> {
  await tx.insert(estabDfaVersion).values(row);
}

/** Next revision number for a DFA (gapless per dfa). */
export async function nextDfaRevNo(tx: Writer, dfaId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(estabDfaVersion).where(eq(estabDfaVersion.dfaId, dfaId));
  return rows.length + 1;
}

/** List all revisions of a DFA, oldest first. */
export async function listDfaVersions(dfaId: string, tenantId: string): Promise<DfaVersionRow[]> {
  return db.select().from(estabDfaVersion)
    .where(and(eq(estabDfaVersion.dfaId, dfaId), eq(estabDfaVersion.tenantId, tenantId)))
    .orderBy(asc(estabDfaVersion.revNo));
}


// ── R8 DFA template library ──────────────────────────────────────────────

import { estabDfaTemplate } from "./schema.js";
import type { DfaTemplateRow, DfaTemplateInsert } from "./schema.js";

export async function insertDfaTemplate(tx: Writer, row: DfaTemplateInsert): Promise<void> {
  await tx.insert(estabDfaTemplate).values(row);
}

export async function listDfaTemplates(tenantId: string): Promise<DfaTemplateRow[]> {
  return db.select().from(estabDfaTemplate)
    .where(and(eq(estabDfaTemplate.tenantId, tenantId), eq(estabDfaTemplate.isActive, true)))
    .orderBy(asc(estabDfaTemplate.code));
}

export async function findDfaTemplateByCode(tenantId: string, code: string): Promise<DfaTemplateRow | null> {
  const rows = await db.select().from(estabDfaTemplate)
    .where(and(eq(estabDfaTemplate.tenantId, tenantId), eq(estabDfaTemplate.code, code), eq(estabDfaTemplate.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}
