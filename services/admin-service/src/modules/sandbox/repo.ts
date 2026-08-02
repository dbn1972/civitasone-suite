/**
 * WC-009 — DB access for sandbox environments, masking rules and refresh jobs.
 * Reads via scopedRead() so RLS is enforced; writes take the caller's tx.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  sandboxEnvironments,
  maskingRules,
  refreshJobs,
  refreshMaskedFields,
  type SandboxEnvironmentRow,
  type SandboxEnvironmentInsert,
  type MaskingRuleRow,
  type MaskingRuleInsert,
  type RefreshJobRow,
  type RefreshJobInsert,
  type RefreshMaskedFieldRow,
  type RefreshMaskedFieldInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
// Drizzle's insert/update builders expose `.returning()` and
// `.returning({ col })`; this narrow structural type covers both without
// pulling the full builder generics into every repo signature.
type Returning<T> = { returning: (fields?: Record<string, unknown>) => Promise<T[]> };

// ── sandbox environments ────────────────────────────────────────────────────

export async function insertSandbox(tx: Writer, row: SandboxEnvironmentInsert): Promise<SandboxEnvironmentRow> {
  const rows = await (tx.insert(sandboxEnvironments).values(row) as unknown as Returning<SandboxEnvironmentRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertSandbox: no row returned");
  return created;
}

/**
 * Look a sandbox up by its tenant-unique `code`. Used by the register route to
 * turn a duplicate code into 409 SANDBOX_EXISTS instead of letting the
 * `uq_sandbox_env_code` violation surface as an opaque 500.
 */
export async function findSandboxByCodeTx(
  tx: Writer, tenantId: string, code: string,
): Promise<SandboxEnvironmentRow | undefined> {
  const rows = await tx.select().from(sandboxEnvironments)
    .where(and(eq(sandboxEnvironments.code, code), eq(sandboxEnvironments.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function findSandboxTx(tx: Writer, tenantId: string, id: string): Promise<SandboxEnvironmentRow | undefined> {
  const rows = await tx.select().from(sandboxEnvironments)
    .where(and(eq(sandboxEnvironments.id, id), eq(sandboxEnvironments.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function findSandbox(tenantId: string, id: string): Promise<SandboxEnvironmentRow | undefined> {
  return scopedRead((tx) => findSandboxTx(tx as Writer, tenantId, id));
}

export async function listSandboxes(
  tenantId: string, limit: number, offset: number,
): Promise<{ rows: SandboxEnvironmentRow[]; total: number }> {
  const where = eq(sandboxEnvironments.tenantId, tenantId);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(sandboxEnvironments).where(where)
      .orderBy(sandboxEnvironments.code).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(sandboxEnvironments).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

/** Optimistic-locked status change on a sandbox. False → 409. */
export async function updateSandboxStatus(
  tx: Writer,
  tenantId: string,
  id: string,
  expectedVersion: number,
  patch: { status: string; updatedBy: string; lastRefreshAt?: Date },
): Promise<boolean> {
  const rows = await (tx.update(sandboxEnvironments)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(sandboxEnvironments.id, id),
      eq(sandboxEnvironments.tenantId, tenantId),
      eq(sandboxEnvironments.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: sandboxEnvironments.id });
  return rows.length > 0;
}

// ── masking rules ───────────────────────────────────────────────────────────

export async function upsertMaskingRule(tx: Writer, row: MaskingRuleInsert): Promise<MaskingRuleRow> {
  const rows = await (tx.insert(maskingRules).values(row)
    .onConflictDoUpdate({
      target: [maskingRules.tenantId, maskingRules.sandboxId, maskingRules.tableName, maskingRules.fieldName],
      set: {
        strategy: row.strategy,
        justification: row.justification ?? "",
        updatedBy: row.updatedBy,
        updatedAt: new Date(),
        version: sql`${maskingRules.version} + 1`,
      },
    }) as unknown as Returning<MaskingRuleRow>).returning();
  const saved = rows[0];
  if (!saved) throw new Error("upsertMaskingRule: no row returned");
  return saved;
}

export async function listMaskingRulesTx(tx: Writer, tenantId: string, sandboxId: string): Promise<MaskingRuleRow[]> {
  return tx.select().from(maskingRules)
    .where(and(eq(maskingRules.tenantId, tenantId), eq(maskingRules.sandboxId, sandboxId)))
    .orderBy(maskingRules.tableName, maskingRules.fieldName);
}

export async function listMaskingRules(
  tenantId: string, sandboxId: string, limit: number, offset: number,
): Promise<{ rows: MaskingRuleRow[]; total: number }> {
  const where = and(eq(maskingRules.tenantId, tenantId), eq(maskingRules.sandboxId, sandboxId));
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(maskingRules).where(where)
      .orderBy(maskingRules.tableName, maskingRules.fieldName).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(maskingRules).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

// ── refresh jobs ────────────────────────────────────────────────────────────

export async function insertRefreshJob(tx: Writer, row: RefreshJobInsert): Promise<RefreshJobRow> {
  const rows = await (tx.insert(refreshJobs).values(row) as unknown as Returning<RefreshJobRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertRefreshJob: no row returned");
  return created;
}

export async function findRefreshJobTx(tx: Writer, tenantId: string, id: string): Promise<RefreshJobRow | undefined> {
  const rows = await tx.select().from(refreshJobs)
    .where(and(eq(refreshJobs.id, id), eq(refreshJobs.tenantId, tenantId))).limit(1);
  return rows[0];
}

export async function findRefreshJob(tenantId: string, id: string): Promise<RefreshJobRow | undefined> {
  return scopedRead((tx) => findRefreshJobTx(tx as Writer, tenantId, id));
}

export async function listRefreshJobs(
  tenantId: string, limit: number, offset: number, status?: string, sandboxId?: string,
): Promise<{ rows: RefreshJobRow[]; total: number }> {
  const clauses = [eq(refreshJobs.tenantId, tenantId)];
  if (status !== undefined) clauses.push(eq(refreshJobs.status, status));
  if (sandboxId !== undefined) clauses.push(eq(refreshJobs.sandboxId, sandboxId));
  const where = and(...clauses);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(refreshJobs).where(where)
      .orderBy(desc(refreshJobs.createdAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(refreshJobs).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

/** Optimistic-locked job update. False → the caller returns 409. */
export async function updateRefreshJob(
  tx: Writer,
  tenantId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<RefreshJobInsert>,
): Promise<boolean> {
  const rows = await (tx.update(refreshJobs)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(refreshJobs.id, id),
      eq(refreshJobs.tenantId, tenantId),
      eq(refreshJobs.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: refreshJobs.id });
  return rows.length > 0;
}

// ── masked-field audit ──────────────────────────────────────────────────────

export async function insertMaskedFields(tx: Writer, rows: RefreshMaskedFieldInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(refreshMaskedFields).values(rows);
}

export async function listMaskedFields(
  tenantId: string, jobId: string, limit: number, offset: number,
): Promise<{ rows: RefreshMaskedFieldRow[]; total: number }> {
  const where = and(eq(refreshMaskedFields.tenantId, tenantId), eq(refreshMaskedFields.jobId, jobId));
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(refreshMaskedFields).where(where)
      .orderBy(refreshMaskedFields.tableName, refreshMaskedFields.fieldName).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(refreshMaskedFields).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}
