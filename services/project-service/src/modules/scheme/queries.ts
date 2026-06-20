import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { SchemeRow } from "./schema.js";

export async function getScheme(id: string, tenantId: string): Promise<SchemeRow | null> {
  return cache.getOrLoad<SchemeRow>(
    cache.makeKey(tenantId, "scheme", id),
    () => repo.findSchemeById(id)
  );
}
