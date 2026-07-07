import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contractTemplates, templateClauses, type TemplateRow, type TemplateClauseRow } from "./schema.js";

/** Execute a read within a tenant-scoped transaction (sets app.tenant_id GUC for RLS). */
async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

// ── Template Queries ────────────────────────────────────────────────────────

export async function findTemplateById(id: string, tenantId: string): Promise<TemplateRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contractTemplates)
      .where(and(eq(contractTemplates.id, id), eq(contractTemplates.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listTemplates(
  tenantId: string,
  opts: { limit: number; offset: number; status?: string },
): Promise<{ data: TemplateRow[]; total: number }> {
  return tenantRead(tenantId, async (tx) => {
    const conditions = [eq(contractTemplates.tenantId, tenantId)];
    if (opts.status) {
      conditions.push(eq(contractTemplates.status, opts.status));
    }

    const where = and(...conditions);

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractTemplates)
      .where(where);

    const data = await tx
      .select()
      .from(contractTemplates)
      .where(where)
      .orderBy(contractTemplates.createdAt)
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: countResult?.count ?? 0 };
  });
}

// ── Template Clause Queries ─────────────────────────────────────────────────

export async function listTemplateClauses(templateId: string, tenantId: string): Promise<TemplateClauseRow[]> {
  return tenantRead(tenantId, async (tx) => {
    return tx
      .select()
      .from(templateClauses)
      .where(and(eq(templateClauses.templateId, templateId), eq(templateClauses.tenantId, tenantId)))
      .orderBy(templateClauses.rank);
  });
}

export async function countTemplateClauses(templateId: string, tenantId: string): Promise<number> {
  return tenantRead(tenantId, async (tx) => {
    const [result] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(templateClauses)
      .where(and(eq(templateClauses.templateId, templateId), eq(templateClauses.tenantId, tenantId)));
    return result?.count ?? 0;
  });
}

export async function findTemplateClause(
  templateId: string,
  clauseId: string,
  tenantId: string,
): Promise<TemplateClauseRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(templateClauses)
      .where(
        and(
          eq(templateClauses.templateId, templateId),
          eq(templateClauses.id, clauseId),
          eq(templateClauses.tenantId, tenantId),
        ),
      )
      .limit(1);
    return row;
  });
}
