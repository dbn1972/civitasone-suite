import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { nextResumeVersion } from "./resume-domain.js";
import {
  hrmsCandidates, hrmsCandidateResumes,
  type ResumeRow, type ResumeInsert,
} from "./candidate-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * postgres-js reports affected rows as `.count` (drizzle's `.rowCount` is
 * undefined on this driver). Normalise both so callers can reliably detect a
 * no-op UPDATE.
 */
function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

/**
 * Sync the denormalised candidate.active_resume_ref and advance the parent
 * row's version/updatedBy — so a resume-driven change to the parent participates
 * in the same optimistic-lock/audit lineage as any other candidate edit
 * (avoids a TOCTOU where a stale reader misses the resume change).
 */
async function syncActiveRef(tx: Writer, tenantId: string, candidateId: string, fileKey: string, actorId: string): Promise<void> {
  await tx.update(hrmsCandidates)
    .set({ activeResumeRef: fileKey, updatedBy: actorId, version: sql`${hrmsCandidates.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.id, candidateId)));
}

export interface NewResume {
  id: string;
  tenantId: string;
  candidateId: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: bigint;
  fingerprint: string | null;
  label: string | null;
  actorId: string;
}

/**
 * Create a new resume version for a candidate. The version number is computed
 * INSIDE the transaction (max existing + 1) so two concurrent uploads cannot
 * collide; the (tenant, candidate, version_no) unique index is the last-line
 * guard. When `activate` is true (or this is the first resume) the new version
 * becomes the active one and candidate.active_resume_ref is synced.
 */
export async function createResumeVersion(
  tx: Writer, row: NewResume, activate: boolean,
): Promise<{ versionNo: number; isActive: boolean }> {
  const existing = await tx.select({ v: hrmsCandidateResumes.versionNo }).from(hrmsCandidateResumes)
    .where(and(eq(hrmsCandidateResumes.tenantId, row.tenantId), eq(hrmsCandidateResumes.candidateId, row.candidateId)));
  const versionNo = nextResumeVersion(existing.map((r) => r.v));
  const isActive = activate || existing.length === 0; // first resume is always active
  if (isActive) {
    await tx.update(hrmsCandidateResumes)
      .set({ isActive: false })
      .where(and(
        eq(hrmsCandidateResumes.tenantId, row.tenantId),
        eq(hrmsCandidateResumes.candidateId, row.candidateId),
        eq(hrmsCandidateResumes.isActive, true),
      ));
  }
  const insert: ResumeInsert = {
    id: row.id, tenantId: row.tenantId, candidateId: row.candidateId, versionNo,
    fileKey: row.fileKey, fileName: row.fileName, mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes, fingerprint: row.fingerprint, label: row.label,
    isActive, createdBy: row.actorId,
  };
  await tx.insert(hrmsCandidateResumes).values(insert);
  if (isActive) {
    await syncActiveRef(tx, row.tenantId, row.candidateId, row.fileKey, row.actorId);
  }
  return { versionNo, isActive };
}

export async function listResumes(tenantId: string, candidateId: string): Promise<ResumeRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCandidateResumes)
    .where(and(eq(hrmsCandidateResumes.tenantId, tenantId), eq(hrmsCandidateResumes.candidateId, candidateId)))
    .orderBy(desc(hrmsCandidateResumes.versionNo)));
}

export async function findResume(tenantId: string, candidateId: string, resumeId: string): Promise<ResumeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCandidateResumes)
    .where(and(
      eq(hrmsCandidateResumes.tenantId, tenantId),
      eq(hrmsCandidateResumes.candidateId, candidateId),
      eq(hrmsCandidateResumes.id, resumeId),
    )).limit(1));
  return rows[0] ?? null;
}

/**
 * Make one resume version the active one: clear the flag on every other version
 * for the candidate, set it on the target, and sync the denormalised
 * candidate.active_resume_ref (which drives profile completeness + downstream
 * reads). One transaction so there is never zero or two active versions.
 * Returns the number of target rows flipped active (0 = target not found).
 */
export async function activateResume(
  tx: Writer, tenantId: string, candidateId: string, resumeId: string, fileKey: string, actorId: string,
): Promise<number> {
  await tx.update(hrmsCandidateResumes)
    .set({ isActive: false })
    .where(and(
      eq(hrmsCandidateResumes.tenantId, tenantId),
      eq(hrmsCandidateResumes.candidateId, candidateId),
      eq(hrmsCandidateResumes.isActive, true),
    ));
  const res = await tx.update(hrmsCandidateResumes)
    .set({ isActive: true })
    .where(and(
      eq(hrmsCandidateResumes.tenantId, tenantId),
      eq(hrmsCandidateResumes.candidateId, candidateId),
      eq(hrmsCandidateResumes.id, resumeId),
    ));
  const n = affected(res);
  if (n > 0) {
    await syncActiveRef(tx, tenantId, candidateId, fileKey, actorId);
  }
  return n;
}
