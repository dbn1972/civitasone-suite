import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ObservationRow } from "./schema.js";

export async function getObservation(id: string, tenantId: string): Promise<ObservationRow | null> {
  return cache.getOrLoad<ObservationRow>(
    cache.makeKey(tenantId, "observation", id),
    () => repo.findObservationById(id),
  );
}
