import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import type { ApiKeyView } from "./domain.js";

export async function listApiKeys(tenantId: string, limit: number, offset: number): Promise<ApiKeyView[]> {
  return repo.listByTenant(tenantId, limit, offset);
}

export async function getApiKey(tenantId: string, id: string): Promise<ApiKeyView | null> {
  const row = await repo.findById(db as unknown as repo.Writer, tenantId, id);
  return row ? repo.toView(row) : null;
}
