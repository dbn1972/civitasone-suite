/**
 * exports/queries.ts — Read handlers for export jobs (cache-backed).
 */
import { cache } from "../../shared/infra.js";
import { EXPORT_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { ExportJobReadView } from "./repo.js";

export async function getExportJob(tenantId: string, id: string): Promise<ExportJobReadView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, EXPORT_RESOURCE, id), () => repo.findById(id, tenantId));
}
