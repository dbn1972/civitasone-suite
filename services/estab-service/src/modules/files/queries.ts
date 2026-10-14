import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { computeFileDueBy, mapNoteTypeForUi } from "./domain.js";
import type { FileRow, NotingRow } from "./schema.js";
import { getEmployeeDisplayMap, type EmployeeDisplay } from "../../shared/hrms-client.js";

export type FileDetailDto = {
  id: string;
  fileNo: string;
  subject: string;
  dept: string;
  department: string;
  classification: string;
  currentWith: string;
  currentHolder: string | null;
  status: string;
  fileType: string;
  volumeNo: number;
  partNo?: number | null;
  parentFileId?: string | null;
  linkedFileIds: string[];
  dakNo?: string | null;
  inwardId?: string | null;
  dueBy?: string | null;
  createdAt: string;
  noteSheets: Array<{
    id: string;
    author: string | null;
    content: string;
    timestamp: string;
    type: "note" | "order" | "remark";
    noteType: string;
    noteStatus: string;
    eSigned: boolean;
  }>;
  movementHistory: Array<{
    id: string;
    fromOfficerId: string | null;
    toOfficerId: string;
    action: string | null;
    remarks: string | null;
    movedAt: string;
  }>;
  dispatchHistory: Array<{
    id: string;
    dispatchedTo: string;
    dispatchedBy: string | null;
    timestamp: string;
    remarks?: string;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    fileType: string;
    size: number;
    uploadedAt: string;
  }>;
};

// officerId here is either a real hrms employeeId (explicit routing/movement/
// dispatch to a named colleague, from the operators directory) or the
// authenticated actor's identity-provider subject (ctx.actorId: notings and
// dispatches author themselves). getEmployeeDisplayMap resolves both through
// hrms-service (employee id, or hrms_employees.user_ref for a linked login),
// batched and tenant-scoped. An actor with no linked employee record cannot be
// named; that is returned as null (web shows the localised "Unknown employee"), never as an id fragment.
// SF-17b: an unresolvable officer is null, never an id fragment or an English
// literal; the web renders the localised employeeFallback.unknownEmployee.
function officerLabel(id: string, employees: Map<string, EmployeeDisplay>): string | null {
  return employees.get(id)?.fullName ?? null;
}

function mapNoting(n: NotingRow, employees: Map<string, EmployeeDisplay>) {
  return {
    id: n.id,
    author: officerLabel(n.officerId, employees),
    content: n.body,
    timestamp: iso(n.createdAt),
    type: mapNoteTypeForUi(n.noteType, n.eSigned),
    noteType: n.noteType,
    noteStatus: n.noteStatus,
    eSigned: n.eSigned,
  };
}

/**
 * Rows served from the read-through cache (cache.getOrLoad) come back JSON-round-
 * tripped, so a timestamp is an ISO string on a cache hit and a Date on a miss.
 * Calling .toISOString() directly 500s the second read of the same file.
 */
function iso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function mapFileBase(file: FileRow, employees: Map<string, EmployeeDisplay>) {
  return {
    id: file.id,
    fileNo: file.fileNo,
    subject: file.subject,
    dept: file.dept,
    department: file.dept,
    classification: file.classification,
    currentWith: file.currentWith,
    currentHolder: officerLabel(file.currentWith, employees),
    status: file.status,
    fileType: file.fileType,
    volumeNo: file.volumeNo,
    partNo: file.partNo,
    parentFileId: file.parentFileId,
    linkedFileIds: file.linkedFileIds ?? [],
    dakNo: file.dakNo,
    inwardId: file.inwardId,
    dueBy: file.dueBy ? iso(file.dueBy) : null,
    createdAt: iso(file.createdAt),
  };
}

export async function getFileDetail(tenantId: string, id: string): Promise<FileDetailDto | null> {
  const file = await cache.getOrLoad<FileRow>(
    cache.makeKey(tenantId, "file", id),
    () => repo.findFileById(id, tenantId),
  );
  if (!file) return null;

  const [notings, movements, dispatches, attachments] = await Promise.all([
    repo.findNotingsByFile(id),
    repo.listFileMovements(id, tenantId),
    repo.listDispatchByFile(id, tenantId),
    repo.listAttachmentsByFile(id, tenantId),
  ]);
  const employees = await getEmployeeDisplayMap(tenantId, [
    file.currentWith,
    ...notings.map((n) => n.officerId),
    ...dispatches.map((d) => d.createdBy),
  ]);

  return {
    ...mapFileBase(file, employees),
    noteSheets: notings.map((n) => mapNoting(n, employees)),
    movementHistory: movements.map((m) => ({
      id: m.id,
      fromOfficerId: m.fromOfficerId,
      toOfficerId: m.toOfficerId,
      action: m.action,
      remarks: m.remarks,
      movedAt: iso(m.movedAt),
    })),
    dispatchHistory: dispatches.map((d) => ({
      id: d.id,
      dispatchedTo: d.toAddress,
      dispatchedBy: officerLabel(d.createdBy, employees),
      timestamp: iso(d.dispatchedAt ?? d.createdAt),
      remarks: d.mode,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType,
      size: a.sizeBytes,
      uploadedAt: iso(a.uploadedAt),
    })),
  };
}

export async function listFiles(tenantId: string, limit: number): Promise<Array<FileRow & { createdByName: string | null }>> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "file", `list:${limit}`),
    () => repo.listFilesByTenant(tenantId, limit),
    60,
  );
  const list = rows ?? [];
  // SF-17b: "Created By" shows a name, not the creator's id. Resolved per page
  // (batched, tenant-scoped), outside the cache so a rename is never stale
  // beyond hrms's own data. null = unresolvable; the web shows "Unknown employee".
  const names = await getEmployeeDisplayMap(tenantId, list.map((f) => f.createdBy));
  return list.map((f) => ({ ...f, createdByName: names.get(f.createdBy)?.fullName ?? null }));
}

export async function listInward(tenantId: string, limit: number, page: repo.RegisterPage = {}) {
  return repo.listInwardByTenant(tenantId, limit, page);
}

/**
 * GAP-ESTAB-FILES-NEW-02: can this DAK (inward) entry become the basis of a NEW file? It must exist in
 * the tenant and not already be linked to a file; otherwise two files would carry one DAK.
 * A detached DAK (fileId cleared) is available again.
 */
export async function inwardLinkState(
  tenantId: string,
  inwardId: string,
): Promise<"missing" | "linked" | "available"> {
  const row = await repo.findInwardById(inwardId, tenantId);
  if (!row) return "missing";
  return row.fileId ? "linked" : "available";
}

/** True when a file with this id exists in the tenant (used to validate a parent file id). */
export async function fileExists(tenantId: string, fileId: string): Promise<boolean> {
  return (await repo.findFileById(fileId, tenantId)) !== null;
}

/** One page of the inward register plus the total matching rows (for "Showing X of N"). */
export async function listInwardPage(tenantId: string, limit: number, page: repo.RegisterPage) {
  const [rows, total] = await Promise.all([
    repo.listInwardByTenant(tenantId, limit, page),
    repo.countInwardByTenant(tenantId, page.q),
  ]);
  return { rows, total };
}

export async function listNotings(tenantId: string, limit: number) {
  return repo.listNotingsByTenant(tenantId, limit);
}

export async function listDispatch(tenantId: string, limit: number, page: repo.RegisterPage = {}) {
  return repo.listDispatchByTenant(tenantId, limit, page);
}

/** One page of the dispatch register plus the total matching rows. */
export async function listDispatchPage(tenantId: string, limit: number, page: repo.RegisterPage) {
  const [rows, total] = await Promise.all([
    repo.listDispatchByTenant(tenantId, limit, page),
    repo.countDispatchByTenant(tenantId, page.q),
  ]);
  return { rows, total };
}

export async function listFileMovements(tenantId: string, fileId: string) {
  return repo.listFileMovements(fileId, tenantId);
}

export async function listInwardMovements(tenantId: string, inwardId: string) {
  return repo.listInwardMovements(inwardId, tenantId);
}

export async function searchFiles(tenantId: string, q: string, limit: number) {
  return repo.searchFiles(tenantId, q, limit);
}

/** Duplicate-subject pre-check (CSMOP one-subject-one-file, R9). */
export async function findSimilarOpenFiles(tenantId: string, subject: string, limit: number) {
  return repo.findSimilarOpenFiles(tenantId, subject, limit);
}

/** GAP-ESTAB-HANDOVER-03: count files held by a specific officer (non-terminal). */
export async function countFilesByHolder(tenantId: string, officerId: string): Promise<number> {
  return repo.countFilesByHolder(tenantId, officerId);
}

/** GAP-ESTAB-INBOX-01: files held by a specific officer ("My Desk"). */
export async function listFilesByHolder(tenantId: string, officerId: string, limit = 100, offset = 0): Promise<FileRow[]> {
  return repo.listFilesByHolder(tenantId, officerId, limit, offset);
}

/**
 * GAP-ESTAB-FILES-DETAIL-02: look up a specific attachment's storageRef for
 * the download endpoint. Returns null if the attachment doesn't exist or
 * doesn't belong to the given file/tenant.
 */
export async function getAttachmentForDownload(
  tenantId: string, fileId: string, attachmentId: string,
): Promise<{ storageRef: string | null; fileName: string; fileType: string } | null> {
  const row = await repo.findAttachmentById(attachmentId, fileId, tenantId);
  if (!row) return null;
  return { storageRef: row.storageRef, fileName: row.fileName, fileType: row.fileType };
}

/** @deprecated use getFileDetail */
export async function getFile(tenantId: string, id: string) {
  return getFileDetail(tenantId, id);
}
