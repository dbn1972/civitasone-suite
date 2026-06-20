import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { FileRow, NotingRow } from "./schema.js";

export type FileWithNotings = FileRow & { notings: NotingRow[] };

export async function getFile(tenantId: string, id: string): Promise<FileWithNotings | null> {
  const file = await cache.getOrLoad<FileRow>(
    cache.makeKey(tenantId, "file", id),
    () => repo.findFileById(id, tenantId)
  );
  if (!file) return null;
  const notings = await repo.findNotingsByFile(id);
  return { ...file, notings };
}

export async function listFiles(tenantId: string, limit: number): Promise<FileRow[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "file", `list:${limit}`),
    () => repo.listFilesByTenant(tenantId, limit),
    60
  );
  return rows ?? [];
}
