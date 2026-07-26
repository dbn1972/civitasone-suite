import { and, desc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  integrationSettings,
  integrationSettingChanges,
  type IntegrationSettingRow,
  type IntegrationSettingInsert,
  type IntegrationChangeRow,
  type IntegrationChangeInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── live settings ─────────────────────────────────────────────────────────────

export async function listSettings(tenantId: string): Promise<IntegrationSettingRow[]> {
  return scopedRead((tx) => tx.select().from(integrationSettings)
    .where(eq(integrationSettings.tenantId, tenantId))
    .orderBy(integrationSettings.provider, integrationSettings.envScope));
}

export async function findSetting(tenantId: string, provider: string, envScope: string): Promise<IntegrationSettingRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(integrationSettings)
    .where(and(eq(integrationSettings.tenantId, tenantId), eq(integrationSettings.provider, provider), eq(integrationSettings.envScope, envScope)))
    .limit(1));
  return rows[0];
}

export async function findSettingTx(tx: Writer, tenantId: string, provider: string, envScope: string): Promise<IntegrationSettingRow | undefined> {
  const rows = await tx.select().from(integrationSettings)
    .where(and(eq(integrationSettings.tenantId, tenantId), eq(integrationSettings.provider, provider), eq(integrationSettings.envScope, envScope)))
    .limit(1);
  return rows[0];
}

export async function insertSetting(tx: Writer, row: IntegrationSettingInsert): Promise<IntegrationSettingRow> {
  const rows = await (tx.insert(integrationSettings).values(row) as unknown as { returning: () => Promise<IntegrationSettingRow[]> }).returning();
  const created = rows[0];
  if (!created) throw new Error("insertSetting: no row returned");
  return created;
}

export async function updateSetting(tx: Writer, id: string, tenantId: string, patch: Partial<IntegrationSettingInsert>): Promise<void> {
  await tx.update(integrationSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(integrationSettings.id, id), eq(integrationSettings.tenantId, tenantId)));
}

/** Update test-status fields on the live row (called after a test-connection). */
export async function recordTest(
  tenantId: string,
  id: string,
  status: "connected" | "failed",
  lastError: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(integrationSettings)
      .set({ status, lastError, lastTestedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(integrationSettings.id, id), eq(integrationSettings.tenantId, tenantId)));
  });
}

// ── change requests (maker-checker) ───────────────────────────────────────────

export async function insertChange(tx: Writer, row: IntegrationChangeInsert): Promise<IntegrationChangeRow> {
  const rows = await (tx.insert(integrationSettingChanges).values(row) as unknown as { returning: () => Promise<IntegrationChangeRow[]> }).returning();
  const created = rows[0];
  if (!created) throw new Error("insertChange: no row returned");
  return created;
}

export async function findChangeByIdTx(tx: Writer, id: string, tenantId: string): Promise<IntegrationChangeRow | undefined> {
  const rows = await tx.select().from(integrationSettingChanges)
    .where(and(eq(integrationSettingChanges.id, id), eq(integrationSettingChanges.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function findLatestPendingTx(tx: Writer, tenantId: string, provider: string, envScope: string): Promise<IntegrationChangeRow | undefined> {
  const rows = await tx.select().from(integrationSettingChanges)
    .where(and(
      eq(integrationSettingChanges.tenantId, tenantId),
      eq(integrationSettingChanges.provider, provider),
      eq(integrationSettingChanges.envScope, envScope),
      eq(integrationSettingChanges.status, "pending"),
    ))
    .orderBy(desc(integrationSettingChanges.createdAt))
    .limit(1);
  return rows[0];
}

export async function updateChange(tx: Writer, id: string, tenantId: string, patch: Partial<IntegrationChangeInsert>): Promise<void> {
  await tx.update(integrationSettingChanges)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(integrationSettingChanges.id, id), eq(integrationSettingChanges.tenantId, tenantId)));
}

export async function listChanges(tenantId: string, provider: string, envScope: string, limit: number): Promise<IntegrationChangeRow[]> {
  return scopedRead((tx) => tx.select().from(integrationSettingChanges)
    .where(and(
      eq(integrationSettingChanges.tenantId, tenantId),
      eq(integrationSettingChanges.provider, provider),
      eq(integrationSettingChanges.envScope, envScope),
    ))
    .orderBy(desc(integrationSettingChanges.createdAt))
    .limit(limit));
}
