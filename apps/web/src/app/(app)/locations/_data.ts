/**
 * location route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls location-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) return [payload.data];
  return [payload];
}

function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.id) ??
      toText(row.key) ??
      toText(row.code) ??
      toText(row.name) ??
      toText(row.agentId) ??
      toText(row.profileId) ??
      toText(row.accountId) ??
      toText(row.conversationId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.label) ??
      toText(row.code) ??
      toText(row.type) ??
      toText(row.entityType) ??
      toText(row.direction) ??
      id;
    const sublabel =
      toText(row.description) ??
      toText(row.status) ??
      toText(row.state) ??
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName) ??
      toText(row.agentId) ??
      toText(row.profileId);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycle);
    const meta =
      toText(row.code) ??
      toText(row.currency) ??
      toText(row.updatedAt) ??
      toText(row.createdAt) ??
      (typeof row.points === "number" ? `${row.points} pts` : undefined) ??
      (typeof row.balance === "number" ? `bal ${row.balance}` : undefined);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return mapped;
}

function moduleLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getLocationList = moduleLoader("/api/v1/locations", "locations.list");
export const getLocationGeofences = moduleLoader("/api/v1/geofences", "locations.geofences");
export const getLocationJurisdictions = moduleLoader("/api/v1/jurisdictions", "locations.jurisdictions");
export const getLocationInfrastructure = moduleLoader("/api/v1/locations/infrastructure", "locations.infrastructure");

// ───────────────────────────────────────────────────────────────────────────
// GAP2-LOCATIONS-INFRASTRUCTURE-01: typed loaders for the infrastructure,
// geofence and jurisdiction child pages. The generic mapRows above flattens
// every record to id/label/sublabel/status/meta and prints row.id.slice(0,8)
// as a UUID column, dropping the attributes that define each record (asset
// type/condition; geofence shape/radius; jurisdiction level/office). These
// typed loaders preserve those attributes so the typed tables (_tables.tsx)
// can show real columns and no raw-UUID column.
// ───────────────────────────────────────────────────────────────────────────

export type InfrastructureRow = {
  id: string;
  name: string;
  type: string;
  condition: string;
  status: string;
};

export type GeofenceRow = {
  id: string;
  name: string;
  type: string;
  shape: string;
  radius: string;
  status: string;
};

export type JurisdictionRow = {
  id: string;
  level: string;
  office: string;
  unit: string;
};

function toNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function mapInfrastructure(payload: unknown): InfrastructureRow[] {
  const out: InfrastructureRow[] = [];
  for (const [i, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const score = toNum(row.conditionScore);
    out.push({
      id: toText(row.id) ?? `row-${i + 1}`,
      name: toText(row.name) ?? "—",
      type: toText(row.type) ?? "—",
      condition: score !== undefined ? `${score}/5` : "—",
      status: toText(row.status) ?? "—",
    });
  }
  return out;
}

function mapGeofences(payload: unknown): GeofenceRow[] {
  const out: GeofenceRow[] = [];
  for (const [i, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const radius = toNum(row.radiusMeters);
    const hasPolygon = Array.isArray(row.polygon) && row.polygon.length > 0;
    const active = row.active;
    out.push({
      id: toText(row.id) ?? `row-${i + 1}`,
      name: toText(row.name) ?? "—",
      type: toText(row.type) ?? "—",
      shape: hasPolygon ? "polygon" : radius !== undefined ? "circle" : "—",
      radius: radius !== undefined ? `${radius} m` : "—",
      status: active === false ? "inactive" : active === true ? "active" : (toText(row.status) ?? "—"),
    });
  }
  return out;
}

function mapJurisdictions(payload: unknown): JurisdictionRow[] {
  const out: JurisdictionRow[] = [];
  for (const [i, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    out.push({
      id: toText(row.id) ?? `row-${i + 1}`,
      level: toText(row.level) ?? "—",
      office: toText(row.officeId) ?? "—",
      unit: toText(row.unitId) ?? "—",
    });
  }
  return out;
}

export function getLocationInfrastructureTyped(): Promise<LoaderResult<InfrastructureRow[]>> {
  return fetchJson<unknown, InfrastructureRow[]>("/api/v1/locations/infrastructure", [], {
    revalidateSeconds: 30,
    telemetryKey: "locations.infrastructure.typed",
    mapResponse: mapInfrastructure,
  });
}

export function getLocationGeofencesTyped(): Promise<LoaderResult<GeofenceRow[]>> {
  return fetchJson<unknown, GeofenceRow[]>("/api/v1/geofences", [], {
    revalidateSeconds: 30,
    telemetryKey: "locations.geofences.typed",
    mapResponse: mapGeofences,
  });
}

export function getLocationJurisdictionsTyped(): Promise<LoaderResult<JurisdictionRow[]>> {
  return fetchJson<unknown, JurisdictionRow[]>("/api/v1/jurisdictions", [], {
    revalidateSeconds: 30,
    telemetryKey: "locations.jurisdictions.typed",
    mapResponse: mapJurisdictions,
  });
}
