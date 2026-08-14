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

export async function incrementUseCount(tenantId: string, id: string): Promise<void> {
  const rows = await scopedRead((tx) =>
    tx.select({ useCount: hrmsJdTemplates.useCount })
      .from(hrmsJdTemplates)
      .where(and(eq(hrmsJdTemplates.id, id), eq(hrmsJdTemplates.tenantId, tenantId)))
      .limit(1)
  );
  if (rows.length === 0) return;
  await db.update(hrmsJdTemplates)
    .set({ useCount: (rows[0]!.useCount ?? 0) + 1, updatedAt: new Date() })
    .where(eq(hrmsJdTemplates.id, id));
}
