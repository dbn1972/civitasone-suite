/**
 * profiles/template-repo.ts — CR-CDP-01 database operations for vertical profile
 * templates. Same shape as the other cdp repos: reads go through scopedRead (so RLS is
 * enforced), writes take the caller's transaction.
 */
import { eq, and, sql, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { profileTemplates, type ProfileTemplateRow, type ProfileTemplateInsert } from "./schema.js";

export function toView(r: ProfileTemplateRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    vertical: r.vertical,
    profileType: r.profileType,
    label: r.label,
    attributes: r.attributesSpec,
    conflictRules: r.conflictRules,
    defaultStrategy: r.defaultStrategy,
    sourcePriority: r.sourcePriority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type ProfileTemplateView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<ProfileTemplateRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(profileTemplates)
      .where(and(eq(profileTemplates.id, id), eq(profileTemplates.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** One template per (tenant, vertical, profileType) — the uniqueness the 409 defends. */
export async function findByVertical(
  vertical: string,
  profileType: string,
  tenantId: string,
): Promise<ProfileTemplateRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(profileTemplates)
      .where(and(
        eq(profileTemplates.vertical, vertical),
        eq(profileTemplates.profileType, profileType),
        eq(profileTemplates.tenantId, tenantId),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { vertical?: string; profileType?: string } = {},
): Promise<{ rows: ProfileTemplateRow[]; total: number }> {
  const conditions: SQL[] = [eq(profileTemplates.tenantId, tenantId)];
  if (filters.vertical !== undefined) conditions.push(eq(profileTemplates.vertical, filters.vertical));
  if (filters.profileType !== undefined) conditions.push(eq(profileTemplates.profileType, filters.profileType));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(profileTemplates)
      .where(where)
      .orderBy(asc(profileTemplates.vertical), asc(profileTemplates.profileType))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(profileTemplates).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ProfileTemplateInsert): Promise<void> {
  await tx.insert(profileTemplates).values(row);
}

/** Optimistic-locked update; false when the template moved on under the caller. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<ProfileTemplateInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(profileTemplates)
    .set({ ...patch, updatedAt: new Date(), version: sql`${profileTemplates.version} + 1` })
    .where(and(
      eq(profileTemplates.id, id),
      eq(profileTemplates.tenantId, tenantId),
      eq(profileTemplates.version, currentVersion),
    ))
    .returning({ id: profileTemplates.id });
  return result.length > 0;
}
