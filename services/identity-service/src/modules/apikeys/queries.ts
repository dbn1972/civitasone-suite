import { scopedRead } from "../../shared/db.js";
import * as repo from "./repo.js";
import type { ApiKeyView } from "./domain.js";

export async function listApiKeys(tenantId: string, limit: number, offset: number): Promise<ApiKeyView[]> {
  return repo.listByTenant(tenantId, limit, offset);
}

/**
 * FQ12-SEC (UAT #69-#72): this used the bare pooled `db`, which runs with no
 * app.tenant_id GUC, so FORCE RLS on apikeys.api_keys returned zero rows and
 * GET /identity/api-keys/:id answered 404 for every key -- and rotate/revoke,
 * which pre-check existence through here, 404'd too, leaving a leaked key
 * impossible to revoke. scopedRead() runs the read inside the tenant
 * transaction (same as listByTenant), so RLS scopes it correctly.
 */
export async function getApiKey(tenantId: string, id: string): Promise<ApiKeyView | null> {
  const row = await scopedRead((tx) => repo.findById(tx as unknown as repo.Writer, tenantId, id));
  return row ? repo.toView(row) : null;
}
