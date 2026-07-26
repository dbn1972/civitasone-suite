/**
 * data-migration / bulk repository.
 *
 * RLS: data_migrations, reconciliations, import_batches and export_jobs all have
 * FORCED row-level security. Reads therefore run inside runWithTenant +
 * db.transaction so the app.tenant_id GUC is set — bare db.select() would return
 * zero rows (the pre-existing facade: GETs read an empty result no matter what).
 */
import { eq, and, desc } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { migrations, reconciliations, importBatches, exportJobs, type ImportBatchRow, type ExportJobRow } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

export function listMigrations(tenantId: string) {
  return scoped(tenantId, (tx) =>
    tx.select().from(migrations).where(eq(migrations.tenantId, tenantId)).orderBy(desc(migrations.createdAt)).limit(50));
}

export function findMigration(tenantId: string, id: string) {
  return scoped(tenantId, async (tx) => {
    const rows = await tx.select().from(migrations)
      .where(and(eq(migrations.id, id), eq(migrations.tenantId, tenantId))).limit(1);
    return rows[0];
  });
}

export function listReconciliationBreaks(tenantId: string, reconId: string) {
  return scoped(tenantId, async (tx) => {
    const rows = await tx.select().from(reconciliations)
      .where(and(eq(reconciliations.id, reconId), eq(reconciliations.tenantId, tenantId))).limit(1);
    return rows[0] ? { reconId, breakCount: rows[0].breakCount, breaks: [] as unknown[] } : null;
  });
}

export function findImportBatch(tenantId: string, id: string): Promise<ImportBatchRow | undefined> {
  return scoped(tenantId, async (tx) => {
    const rows = await tx.select().from(importBatches)
      .where(and(eq(importBatches.id, id), eq(importBatches.tenantId, tenantId))).limit(1);
    return rows[0];
  });
}

export function findExportJob(tenantId: string, id: string): Promise<ExportJobRow | undefined> {
  return scoped(tenantId, async (tx) => {
    const rows = await tx.select().from(exportJobs)
      .where(and(eq(exportJobs.id, id), eq(exportJobs.tenantId, tenantId))).limit(1);
    return rows[0];
  });
}
