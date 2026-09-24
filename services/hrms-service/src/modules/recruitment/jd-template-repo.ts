import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsJdTemplates, type JdTemplateInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertTemplate(tx: Writer, row: JdTemplateInsert): Promise<void> {
  await tx.insert(hrmsJdTemplates).values(row);
}

export async function findTemplateById(id: string, tenantId: string) {
  const rows = await scopedRead((tx) =>
    tx.select().from(hrmsJdTemplates)
      .where(and(eq(hrmsJdTemplates.id, id), eq(hrmsJdTemplates.tenantId, tenantId)))
      .limit(1)
  );
  return rows[0] ?? null;
}

export async function listTemplates(tenantId: string, opts: { vacancyType?: string; limit?: number }) {
  const base = scopedRead((tx) =>
    tx.select().from(hrmsJdTemplates)
      .where(and(
        eq(hrmsJdTemplates.tenantId, tenantId),
        eq(hrmsJdTemplates.isArchived, false),
      ))
      .orderBy(desc(hrmsJdTemplates.useCount), desc(hrmsJdTemplates.createdAt))
      .limit(opts.limit ?? 100)
  );
  const rows = await base;
  if (opts.vacancyType) return rows.filter((r) => r.vacancyType === opts.vacancyType);
  return rows;
}

export async function updateTemplate(tx: Writer, id: string, patch: Partial<JdTemplateInsert>): Promise<void> {
  await tx.update(hrmsJdTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(hrmsJdTemplates.id, id));
}

/**
 * MEDIUM finding fix-up: the write below used to be a bare `db.update()`,
 * outside any `db.transaction(...)`. hrms_jd_templates carries FORCE RLS
 * like every other hrms-service table (see actor-link.ts's
 * resolveEmployeeForActor doc comment for the canonical explanation of this
 * exact trap): a bare call runs on a pooled connection with no
 * app.tenant_id GUC set, so under the NOBYPASSRLS service role the
 * fail-closed RLS policy silently matched ZERO rows -- useCount never
 * actually incremented, with no error to notice (confirmed live: this was
 * the reason the regression test for this fix kept seeing useCount stay at
 * 0). Wrapping in db.transaction makes wrapWithTenantGuc set the GUC from
 * AsyncLocalStorage, same as every other real write in this codebase.
 */
export async function incrementUseCount(tenantId: string, id: string): Promise<void> {
  const rows = await scopedRead((tx) =>
    tx.select({ useCount: hrmsJdTemplates.useCount })
      .from(hrmsJdTemplates)
      .where(and(eq(hrmsJdTemplates.id, id), eq(hrmsJdTemplates.tenantId, tenantId)))
      .limit(1)
  );
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.update(hrmsJdTemplates)
      .set({ useCount: (rows[0]!.useCount ?? 0) + 1, updatedAt: new Date() })
      .where(and(eq(hrmsJdTemplates.id, id), eq(hrmsJdTemplates.tenantId, tenantId)));
  });
}
