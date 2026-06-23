import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { computeFileDueBy, mapNoteTypeForUi } from "./domain.js";
import type { FileRow, NotingRow } from "./schema.js";

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

function officerLabel(id: string): string {
  return id.slice(0, 8);
}

function mapNoting(n: NotingRow) {
  return {
    id: n.id,
    author: officerLabel(n.officerId),
    content: n.body,
    timestamp: n.createdAt.toISOString(),
    type: mapNoteTypeForUi(n.noteType, n.eSigned),
    noteType: n.noteType,
    noteStatus: n.noteStatus,
    eSigned: n.eSigned,
  };
}

function mapFileBase(file: FileRow) {
  return {
    id: file.id,
    fileNo: file.fileNo,
    subject: file.subject,
    dept: file.dept,
    department: file.dept,
    classification: file.classification,
    currentWith: file.currentWith,
    currentHolder: officerLabel(file.currentWith),
    status: file.status,
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

  const [notings, movements, dispatches, attachments] = await Promise.all([
    repo.findNotingsByFile(id),
    repo.listFileMovements(id, tenantId),
    repo.listDispatchByFile(id, tenantId),
    repo.listAttachmentsByFile(id, tenantId),
  ]);

  return {
    ...mapFileBase(file),
    noteSheets: notings.map(mapNoting),
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
      dispatchedBy: officerLabel(d.createdBy),
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

export async function listDispatch(tenantId: string, limit: number) {
  return repo.listDispatchByTenant(tenantId, limit);
}

export async function listFileMovements(tenantId: string, fileId: string) {
  return repo.listFileMovements(fileId, tenantId);
}

/** @deprecated use getFileDetail */
export async function getFile(tenantId: string, id: string) {
  return getFileDetail(tenantId, id);
}
