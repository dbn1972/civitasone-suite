import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { StoreRow } from "./schema.js";

export async function listStores(tenantId: string, limit: number, offset: number): Promise<StoreRow[]> {
  const hash = `list:${limit}:${offset}`;
  return (await cache.listOrLoad(tenantId, RESOURCE.store, hash, () => repo.listStores(tenantId, limit, offset))) ?? [];
}
