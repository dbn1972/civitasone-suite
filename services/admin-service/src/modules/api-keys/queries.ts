import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listApiKeys(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "api_keys", `list:${limit}`),
    () => repo.listByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    keyName: row.keyName,
    keyPrefix: row.keyPrefix,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString(),
    expiresAt: row.expiresAt?.toISOString(),
    scopes: row.scopes ?? [],
    status: (["active", "expired", "revoked"].includes(row.status) ? row.status : "active") as "active" | "expired" | "revoked",
  }));
}
