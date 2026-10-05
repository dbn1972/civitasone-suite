/** Read side (GET handlers). Views never expose storage keys of other tenants (all queries are tenant-scoped + RLS). */
import * as repo from "./repo.js";
import { PIPELINE_SETTLED_STATES } from "./state.js";
import type { BatchRow, BatchFileRow, ProfileRow, ChangeRequestRow, FileEventRow } from "./schema.js";

export interface BatchView {
  id: string; name: string; status: string; targetFolderId: string | null; defaultTags: string[]; defaultDocType: string | null;
  linkTarget: Record<string, unknown> | null; profileId: string | null; fileCount: number; totalBytes: number;
  counts: Record<string, number>; progress: { total: number; settled: number; percent: number };
  createdBy: string; createdAt: Date; updatedAt: Date; completedAt: Date | null; cancelledAt: Date | null; version: number;
}

export function toBatchView(b: BatchRow, counts: Record<string, number>): BatchView {
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  const settled = PIPELINE_SETTLED_STATES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  return {
    id: b.id, name: b.name, status: b.status, targetFolderId: b.targetFolderId, defaultTags: b.defaultTags, defaultDocType: b.defaultDocType,
    linkTarget: b.linkTarget ?? null, profileId: b.profileId, fileCount: b.fileCount, totalBytes: b.totalBytes, counts,
    progress: { total, settled, percent: total === 0 ? 0 : Math.round((settled / total) * 100) },
    createdBy: b.createdBy, createdAt: b.createdAt, updatedAt: b.updatedAt, completedAt: b.completedAt, cancelledAt: b.cancelledAt, version: b.version,
  };
}

export async function listBatches(tenantId: string, o: { status?: string | undefined; limit: number; offset: number }) {
  const rows = await repo.listBatches(tenantId, o);
  const counts = await repo.stateCounts(tenantId, rows.map((r) => r.id));
  return { data: rows.map((r) => toBatchView(r, counts.get(r.id) ?? {})), pagination: { hasMore: rows.length === o.limit, pageSize: o.limit } };
}

export async function getBatch(tenantId: string, id: string): Promise<BatchView | null> {
  const b = await repo.getBatch(tenantId, id);
  if (!b) return null;
  const counts = await repo.stateCounts(tenantId, [id]);
  return toBatchView(b, counts.get(id) ?? {});
}

export interface FileView {
  id: string; batchId: string; originalName: string; mimeType: string | null; sizeBytes: number | null; state: string;
  failureReason: string | null; failureDetail: string | null; deadLetter: boolean; attempts: number; nextAttemptAt: Date | null;
  scanStatus: string | null; pageCount: number | null; ocrMeanConfidence: number | null; docType: string | null;
  classification: Record<string, unknown> | null; piiFlags: string[] | null; reviewReasons: string[] | null;
  duplicateOf: string | null; duplicateAction: string | null; filedDocumentId: string | null; tags: string[];
  reviewedBy: string | null; reviewedAt: Date | null; createdAt: Date; updatedAt: Date; version: number;
  /** Latest link of this file (additive; null when the file has no link). reason/detail are the shared target codes. */
  link: repo.FileLinkSummary | null;
}

/**
 * Storage keys, extracted field values, page text, PII findings and reviewer overrides are deliberately NOT exposed:
 * under the default PII policy (pan/bank_account/phone/email = flag) extracted fields hold RAW values, and these
 * list/detail routes are un-audited. Field values are shown only on the audited, masked review route.
 * Storage keys are deliberately NOT exposed; downloads go through a presigned, audited endpoint (filing wave). */
export function toFileView(f: BatchFileRow, link: repo.FileLinkSummary | null = null): FileView {
  return {
    id: f.id, batchId: f.batchId, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, state: f.state,
    failureReason: f.failureReason, failureDetail: f.failureDetail, deadLetter: f.deadLetter, attempts: f.attempts, nextAttemptAt: f.nextAttemptAt,
    scanStatus: f.scanStatus, pageCount: f.pageCount, ocrMeanConfidence: f.ocrMeanConfidence === null ? null : Number(f.ocrMeanConfidence),
    docType: f.docType, classification: f.classification ?? null, piiFlags: f.piiFlags ?? null,
    reviewReasons: f.reviewReasons ?? null, duplicateOf: f.duplicateOf, duplicateAction: f.duplicateAction, filedDocumentId: f.filedDocumentId,
    tags: f.tags, reviewedBy: f.reviewedBy, reviewedAt: f.reviewedAt, createdAt: f.createdAt, updatedAt: f.updatedAt, version: f.version,
    link,
  };
}

export async function listBatchFiles(tenantId: string, batchId: string, o: { state?: string | undefined; limit: number; offset: number }) {
  const rows = await repo.listBatchFiles(tenantId, batchId, o);
  const linkMap = await repo.latestLinkSummaries(tenantId, rows.map((r) => r.id));
  return { data: rows.map((r) => toFileView(r, linkMap.get(r.id) ?? null)), pagination: { hasMore: rows.length === o.limit, pageSize: o.limit } };
}

export async function getFile(tenantId: string, id: string): Promise<FileView | null> {
  const f = await repo.getFile(tenantId, id);
  if (!f) return null;
  return toFileView(f, (await repo.latestLinkSummaries(tenantId, [id])).get(id) ?? null);
}

export async function fileEvents(tenantId: string, fileId: string): Promise<FileEventRow[]> {
  return repo.listFileEvents(tenantId, fileId);
}

export interface SettingsView { settings: unknown; version: number; degraded: boolean; pendingRequests: ChangeRequestRow[] }

export async function getSettings(tenantId: string): Promise<SettingsView> {
  const eff = await repo.resolveEffectiveSettings(tenantId);
  const pending = await repo.listChangeRequests(tenantId, "pending");
  return { settings: eff.settings, version: eff.version, degraded: eff.degraded, pendingRequests: pending };
}

export const listChangeRequests = (tenantId: string, status?: string): Promise<ChangeRequestRow[]> => repo.listChangeRequests(tenantId, status);
export const getChangeRequest = (tenantId: string, id: string): Promise<ChangeRequestRow | null> => repo.getChangeRequest(tenantId, id);
export const listProfiles = (tenantId: string): Promise<ProfileRow[]> => repo.listProfiles(tenantId);
export const getProfile = (tenantId: string, id: string): Promise<ProfileRow | null> => repo.getProfile(tenantId, id);
