import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { IndentRow } from "./schema.js";

export async function getIndent(id: string, tenantId: string): Promise<IndentRow | null> {
  return cache.getOrLoad<IndentRow>(
    cache.makeKey(tenantId, "indent", id),
    () => repo.findIndentById(id)
  );
}

export async function listIndents(tenantId: string): Promise<IndentRow[]> {
  const result = await cache.getOrLoad<IndentRow[]>(
    cache.makeKey(tenantId, "indents", "list"),
    () => repo.findIndentsByTenant(tenantId)
  );
  return result ?? [];
}
