import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RtiRow } from "./schema.js";

export async function getRti(tenantId: string, id: string): Promise<(RtiRow & { responses: Awaited<ReturnType<typeof repo.listResponses>>; appeals: Awaited<ReturnType<typeof repo.listAppeals>> }) | null> {
  const rti = await cache.getOrLoad<RtiRow | null>(
    cache.makeKey(tenantId, "rti", id),
    () => repo.findRtiById(id),
  );
  if (!rti || rti.tenantId !== tenantId) return null;
  const [responses, appeals] = await Promise.all([repo.listResponses(id), repo.listAppeals(id)]);
  return { ...rti, responses, appeals };
}
