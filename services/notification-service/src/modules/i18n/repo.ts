import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { localeVariants } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Find a locale variant by template + locale within a tenant. */
export async function findVariant(
  tenantId: string, templateId: string, locale: string,
): Promise<typeof localeVariants.$inferSelect | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(localeVariants)
      .where(and(
        eq(localeVariants.tenantId, tenantId),
        eq(localeVariants.templateId, templateId),
        eq(localeVariants.locale, locale),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** List all locale variants for a template within a tenant. */
export async function listVariants(
  tenantId: string, templateId: string,
): Promise<typeof localeVariants.$inferSelect[]> {
  return scopedRead((tx) =>
    tx.select().from(localeVariants)
      .where(and(
        eq(localeVariants.tenantId, tenantId),
        eq(localeVariants.templateId, templateId),
      )),
  );
}

/** Flag all "current" variants for a template as "needs_review" (stale). */
export async function flagStaleVariants(
  tx: Writer, tenantId: string, templateId: string, actorId: string,
): Promise<number> {
  const updated = await tx.update(localeVariants).set({
    status: "needs_review",
    updatedAt: new Date(),
    updatedBy: actorId,
  }).where(and(
    eq(localeVariants.tenantId, tenantId),
    eq(localeVariants.templateId, templateId),
    eq(localeVariants.status, "current"),
  )).returning({ id: localeVariants.id });
  return updated.length;
}

/** Insert a new locale variant. */
export async function insertVariant(
  tx: Writer,
  data: typeof localeVariants.$inferInsert,
): Promise<void> {
  await tx.insert(localeVariants).values(data);
}

/** Update an existing locale variant by ID. */
export async function updateVariant(
  tx: Writer,
  id: string,
  tenantId: string,
  data: Partial<Pick<typeof localeVariants.$inferSelect, "subject" | "body" | "status" | "updatedBy" | "updatedAt" | "version">>,
): Promise<void> {
  await tx.update(localeVariants).set({
    ...data,
    updatedAt: new Date(),
  }).where(and(
    eq(localeVariants.id, id),
    eq(localeVariants.tenantId, tenantId),
  ));
}
