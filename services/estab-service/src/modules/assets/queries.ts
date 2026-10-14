import { cache } from "../../shared/infra.js";
import { getEmployeeDisplayMap } from "../../shared/hrms-client.js";
import * as repo from "./repo.js";
import type { VehicleRow } from "./schema.js";

/**
 * The stored fuel type is the create-body value ("ev" for electric); the summary reports "electric".
 * "ev" used to fall through to "petrol", so every electric vehicle was listed as a petrol one.
 */
export function mapFuelType(fuelType: string): "petrol" | "diesel" | "cng" | "electric" {
  if (fuelType === "diesel") return "diesel";
  if (fuelType === "cng") return "cng";
  if (fuelType === "ev" || fuelType === "electric") return "electric";
  return "petrol";
}

/**
 * "Toyota Innova Crysta" -> make "Toyota", model "Innova Crysta". The model is everything after the
 * first word (it used to be only the second word, dropping the rest), and is empty for a one-word
 * entry rather than repeating the make.
 */
export function splitMakeModel(makeModel: string): { make: string; model: string } {
  const trimmed = makeModel.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { make: trimmed, model: "" };
  return { make: trimmed.slice(0, space), model: trimmed.slice(space + 1).trim() };
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

/**
 * Pure row → VehicleSummary mapper. GAP-ESTAB-VEHICLES-02: resolves the
 * allocatedTo officer id to a display name via `displayMap` (best-effort).
 * When the id is absent, `assignedTo`/`assignedToName` are both left off so
 * the UI shows "Pool"; when the id is present but unresolved,
 * `assignedToName` is omitted so the UI falls back to "—" (never the raw
 * UUID). Extracted and exported so the enrichment is unit-testable without
 * DB/cache/hrms infra.
 */
export function toVehicleSummary(
  row: Pick<VehicleRow, "id" | "regNo" | "makeModel" | "allocatedTo" | "fuelType" | "status" | "odometerKm">,
  displayMap: Map<string, { fullName: string }>,
) {
  const { make, model } = splitMakeModel(row.makeModel);
  const assignedTo = row.allocatedTo ?? undefined;
  const assignedToName = assignedTo ? displayMap.get(assignedTo)?.fullName : undefined;
  return {
    id: row.id,
    vehicleNo: row.regNo,
    make,
    model,
    type: "other" as const,
    assignedTo,
    ...(assignedToName ? { assignedToName } : {}),
    fuelType: mapFuelType(row.fuelType),
    status: mapVehicleStatus(row.status),
    odometerKm: row.odometerKm,
  };
}

export async function listVehicleSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "vehicles", `list:${limit}`),
    () => repo.listVehiclesByTenant(tenantId, limit),
  );
  // GAP-ESTAB-VEHICLES-02: resolve the allocatedTo officer id to a display
  // name (best-effort; never throws, empty map on hrms failure), mirroring
  // quarter-allotments' employeeName enrichment. The UI shows the name, or
  // "Pool"/"—" — never the raw UUID.
  const displayMap = await getEmployeeDisplayMap(tenantId);
  return (rows ?? []).map((row) => toVehicleSummary(row, displayMap));
}
