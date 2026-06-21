import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { VehicleRow } from "./schema.js";

function mapFuelType(fuelType: string): "petrol" | "diesel" | "cng" | "electric" {
  if (fuelType === "diesel") return "diesel";
  if (fuelType === "cng") return "cng";
  if (fuelType === "electric") return "electric";
  return "petrol";
}

function mapVehicleStatus(status: string): "available" | "in_use" | "maintenance" | "reserved" | "disposed" {
  if (status === "in_use") return "in_use";
  if (status === "maintenance") return "maintenance";
  if (status === "reserved") return "reserved";
  if (status === "disposed") return "disposed";
  return "available";
}

export async function getVehicle(tenantId: string, id: string): Promise<VehicleRow | null> {
  return cache.getOrLoad<VehicleRow>(
    cache.makeKey(tenantId, "vehicle", id),
    () => repo.findVehicleById(id, tenantId)
  );
}

export async function listVehicleSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "vehicles", `list:${limit}`),
    () => repo.listVehiclesByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => {
    const [make = row.makeModel, model = ""] = row.makeModel.split(" ");
    return {
      id: row.id,
      vehicleNo: row.regNo,
      make,
      model: model || row.makeModel,
      type: "other" as const,
      assignedTo: row.allocatedTo ?? undefined,
      fuelType: mapFuelType(row.fuelType),
      status: mapVehicleStatus(row.status),
      odometerKm: row.odometerKm,
    };
  });
}
