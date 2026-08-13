/**
 * document-service — server-side loaders (Server Components only).
 * Gateway rewrites "/api/v1/documents" → document-service "/v1/documents".
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { FileSummary, FolderSummary, DakSummary, DocumentStats } from "./types";

function asArray(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}
function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}
function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : v == null ? fb : String(v); }
function strOrNull(v: unknown): string | null { return typeof v === "string" && v.length > 0 ? v : null; }
function num(v: unknown, fb = 0): number { return typeof v === "number" && Number.isFinite(v) ? v : fb; }

function toFile(r: Record<string, unknown>): FileSummary {
  return {
    id:        str(r.id),
    name:      str(r.name),
    folderId:  strOrNull(r.folderId),
    mimeType:  strOrNull(r.mimeType),
    sizeBytes: typeof r.sizeBytes === "number" ? r.sizeBytes : null,
    tags:      Array.isArray(r.tags) ? (r.tags as unknown[]).map((t) => str(t)) : [],
    status:    str(r.status, "active"),
    version:   num(r.version, 1),
    updatedAt: str(r.updatedAt),
  };
}

function toFolder(r: Record<string, unknown>): FolderSummary {
  return { id: str(r.id), name: str(r.name), parentId: strOrNull(r.parentId), path: str(r.path, "/") };
}

function toDak(r: Record<string, unknown>): DakSummary {
  return {
    id:         str(r.id),
    subject:    str(r.subject),
    priority:   str(r.priority, "normal"),
    status:     str(r.status, "pending"),
    assignedTo: strOrNull(r.assignedTo),
    dueDate:    strOrNull(r.dueDate),
    createdAt:  str(r.createdAt),
  };
}

export function getDocumentFiles(folderId?: string): Promise<LoaderResult<FileSummary[]>> {
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  return fetchJson<unknown, FileSummary[]>(`/api/v1/documents/files${qs}`, [], {
    revalidateSeconds: 20,
    telemetryKey: "documents.files",
    mapResponse: (p) => {
      const arr = asObj(p);
      const list = arr ? asArray(arr.data) : asArray(p);
      return list.map(toFile);
    },
  });
}

export function getDocumentFolders(): Promise<LoaderResult<FolderSummary[]>> {
  return fetchJson<unknown, FolderSummary[]>("/api/v1/documents/folders", [], {
    revalidateSeconds: 30,
    telemetryKey: "documents.folders",
    mapResponse: (p) => {
      const obj = asObj(p);
      const list = obj ? asArray(obj.data) : asArray(p);
      return list.map(toFolder);
    },
  });
}

export function getDocumentInbox(): Promise<LoaderResult<DakSummary[]>> {
  return fetchJson<unknown, DakSummary[]>("/api/v1/documents/inbox", [], {
    revalidateSeconds: 15,
    telemetryKey: "documents.inbox",
    mapResponse: (p) => {
      const obj = asObj(p);
      const list = obj ? asArray(obj.data) : asArray(p);
      return list.map(toDak);
    },
  });
}

export function getDocumentStats(): Promise<LoaderResult<DocumentStats>> {
  const empty: DocumentStats = { inboxCount: 0, pendingCount: 0, urgentCount: 0 };
  return fetchJson<unknown, DocumentStats>("/api/v1/documents/inbox/summary", empty, {
    revalidateSeconds: 30,
    telemetryKey: "documents.stats",
    mapResponse: (p) => {
      const r = asObj(p);
      if (!r) return empty;
      return { inboxCount: num(r.inboxCount), pendingCount: num(r.pendingCount), urgentCount: num(r.urgentCount) };
    },
  });
}
