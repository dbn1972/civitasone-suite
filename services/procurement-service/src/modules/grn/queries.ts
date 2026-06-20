import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { GrnRow } from "./schema.js";

export async function getGrn(id: string, tenantId: string): Promise<GrnRow | null> {
  return cache.getOrLoad<GrnRow>(
    cache.makeKey(tenantId, "grn", id),
    () => repo.findGrnById(id)
  );
}
