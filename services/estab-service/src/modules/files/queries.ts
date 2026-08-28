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
  currentHolder: string;
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
    author: string;
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
    dispatchedBy: string;
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

// SECURITY/DATA-INTEGRITY: this used to unconditionally truncate the id
// (`id.slice(0, 8)`) and never even attempted a real lookup. officerId here
// may be a real hrms employeeId (explicit routing/movement/dispatch to a
// named colleague, sourced from the operators directory) — in that case we
// now resolve and show their actual name via hrms-service, the authoritative
// source for employee identity, instead of always fabricating a fake label.
// A self-authored id (ctx.actorId, a Keycloak subject) will still not be
// found in `employees` and falls back to truncation: there is currently no
// employee↔identity bridge anywhere in this platform to resolve that case
// (see hrms-client.ts's doc comment and the PR description) — that is a
// separate, larger platform gap, not something this fix can close.
function officerLabel(id: string, employees: Map<string, EmployeeDisplay>): string {
  return employees.get(id)?.fullName ?? id.slice(0, 8);
}

function mapNoting(n: NotingRow, employees: Map<string, EmployeeDisplay>) {
  return {
    id: n.id,
    author: officerLabel(n.officerId, employees),
    content: n.body,
    timestamp: n.createdAt.toISOString(),
    type: mapNoteTypeForUi(n.noteType, n.eSigned),
    noteType: n.noteType,
    noteStatus: n.noteStatus,
    eSigned: n.eSigned,
  };
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
    dueBy: file.dueBy?.toISOString() ?? null,
    createdAt: file.createdAt.toISOString(),
  };
}

export async function getFileDetail(tenantId: string, id: string): Promise<FileDetailDto | null> {
  const file = await cache.getOrLoad<FileRow>(
    cache.makeKey(tenantId, "file", id),
    () => repo.findFileById(id, tenantId),
  );
  if (!file) return null;

  const [notings, movements, dispatches, attachments, employees] = await Promise.all([
    repo.findNotingsByFile(id),
    repo.listFileMovements(id, tenantId),
    repo.listDispatchByFile(id, tenantId),
    repo.listAttachmentsByFile(id, tenantId),
    // Best-effort, cached, tenant-scoped hrms lookup for officer display
    // names — see hrms-client.ts. Never throws/blocks: an hrms-service
    // outage degrades every label to id truncation, it never breaks the read.
    getEmployeeDisplayMap(tenantId),
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
      movedAt: m.movedAt.toISOString(),
    })),
    dispatchHistory: dispatches.map((d) => ({
      id: d.id,
      dispatchedTo: d.toAddress,
      dispatchedBy: officerLabel(d.createdBy, employees),
      timestamp: (d.dispatchedAt ?? d.createdAt).toISOString(),
      remarks: d.mode,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileType: a.fileType,
      size: a.sizeBytes,
      uploadedAt: a.uploadedAt.toISOString(),
    })),
  };
}

export async function listFiles(tenantId: string, limit: number): Promise<FileRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "file", `list:${limit}`),
    () => repo.listFilesByTenant(tenantId, limit),
    60,
  );
  return rows ?? [];
}

export async function listInward(tenantId: string, limit: number) {
  return repo.listInwardByTenant(tenantId, limit);
}

export async function listNotings(tenantId: string, limit: number) {
  return repo.listNotingsByTenant(tenantId, limit);
}

export async function listDispatch(tenantId: string, limit: number) {
  return repo.listDispatchByTenant(tenantId, limit);
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

/** @deprecated use getFileDetail */
export async function getFile(tenantId: string, id: string) {
  return getFileDetail(tenantId, id);
}
