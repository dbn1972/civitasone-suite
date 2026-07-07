import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { MatterDocumentRow, DocumentVersionRow } from "./schema.js";

export async function getDocument(id: string, tenantId: string): Promise<MatterDocumentRow | null> {
  return cache.getOrLoad<MatterDocumentRow>(
    cache.makeKey(tenantId, "document", id),
    () => repo.findDocumentById(id),
  );
}

export async function listDocuments(
  tenantId: string,
  matterId: string,
  parentFolderId?: string,
): Promise<MatterDocumentRow[]> {
  const parentKey = parentFolderId ?? "root";
  const cacheKey = cache.makeKey(tenantId, "documents", `${matterId}:${parentKey}`);
  return (await cache.getOrLoad(cacheKey, () => repo.listDocuments(tenantId, matterId, parentFolderId))) ?? [];
}

export async function getVersionHistory(
  documentId: string,
  tenantId: string,
  limit: number,
): Promise<DocumentVersionRow[]> {
  const cacheKey = cache.makeKey(tenantId, "doc-versions", documentId);
  return (await cache.getOrLoad(cacheKey, () => repo.listVersions(documentId, limit))) ?? [];
}
