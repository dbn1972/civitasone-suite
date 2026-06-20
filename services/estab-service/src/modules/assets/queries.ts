import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VehicleRow } from "./schema.js";

export async function getVehicle(tenantId: string, id: string): Promise<VehicleRow | null> {
  return cache.getOrLoad<VehicleRow>(
    cache.makeKey(tenantId, "vehicle", id),
    () => repo.findVehicleById(id, tenantId)
  );
}
