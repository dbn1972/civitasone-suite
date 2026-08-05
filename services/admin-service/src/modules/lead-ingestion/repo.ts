/**
 * lead-ingestion repository. Writes run inside db.transaction (tenant GUC set by
 * the caller's runWithTenant); reads use scopedRead so RLS is enforced.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { sftpIngestionRuns, sftpIngestedFiles } from "./schema.js";
import type { SftpIngestionRunRow, SftpIngestionRunInsert, SftpIngestedFileInsert } from "./schema.js";

type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRun(tenantId: string, env: string): Promise<SftpIngestionRunRow> {
  return db.transaction(async (tx) => {
    const rows = (await (tx as typeof db).insert(sftpIngestionRuns).values({
      tenantId, provider: "sftp", env, status: "running",
    } as SftpIngestionRunInsert).returning()) as SftpIngestionRunRow[];
    const created = rows[0];
    if (!created) throw new Error("insertRun: no row returned");
    return created;
  });
}

export async function finishRun(
  tenantId: string,
  id: string,
  patch: { status: string; filesSeen: number; rowsTotal: number; rowsCreated: number; rowsFailed: number; error?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(sftpIngestionRuns)
      .set({
        status: patch.status,
        filesSeen: patch.filesSeen,
        rowsTotal: patch.rowsTotal,
        rowsCreated: patch.rowsCreated,
        rowsFailed: patch.rowsFailed,
        error: patch.error ?? null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(sftpIngestionRuns.id, id), eq(sftpIngestionRuns.tenantId, tenantId)));
  });
}

export async function listRuns(tenantId: string, env: string | undefined, limit: number): Promise<SftpIngestionRunRow[]> {
  const preds = [eq(sftpIngestionRuns.tenantId, tenantId), eq(sftpIngestionRuns.provider, "sftp")];
  if (env) preds.push(eq(sftpIngestionRuns.env, env));
  return scopedRead((tx) => tx.select().from(sftpIngestionRuns)
    .where(and(...preds))
    .orderBy(desc(sftpIngestionRuns.startedAt))
    .limit(limit));
}

/** Idempotency check: has this (tenant,provider,env,filename,checksum) been ingested? */
export async function isIngested(tenantId: string, env: string, filename: string, checksum: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ id: sftpIngestedFiles.id }).from(sftpIngestedFiles)
    .where(and(
      eq(sftpIngestedFiles.tenantId, tenantId),
      eq(sftpIngestedFiles.provider, "sftp"),
      eq(sftpIngestedFiles.env, env),
      eq(sftpIngestedFiles.filename, filename),
      eq(sftpIngestedFiles.checksum, checksum),
    ))
    .limit(1));
  return rows.length > 0;
}

/** Record a file as ingested. ON CONFLICT DO NOTHING on the idempotency key. */
export async function recordIngestedFile(tenantId: string, env: string, f: { filename: string; checksum: string; sizeBytes: number; runId?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await (tx as typeof db).insert(sftpIngestedFiles).values({
      tenantId, provider: "sftp", env,
      filename: f.filename, checksum: f.checksum, sizeBytes: f.sizeBytes,
      ...(f.runId ? { runId: f.runId } : {}),
    } as SftpIngestedFileInsert).onConflictDoNothing({
      target: [sftpIngestedFiles.tenantId, sftpIngestedFiles.provider, sftpIngestedFiles.env, sftpIngestedFiles.filename, sftpIngestedFiles.checksum],
    });
  });
}

// Exposed for tests that assert on the raw sql helper (unused placeholder kept minimal).
export const _sql = sql;
export type { Writer };
