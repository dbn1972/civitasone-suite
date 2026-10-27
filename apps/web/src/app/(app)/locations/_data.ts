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
// every record to id/label/sublabel/status/meta and prints a truncated id
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
  /** Asset-register record this infrastructure asset is (GAP-LOCATIONS-INFRASTRUCTURE-06); absent = not linked. */
  assetId?: string;
};

export type GeofenceRow = {
  id: string;
  name: string;
  type: string;
  shape: string;
  radius: string;
  /** Centre point "lat, lng" to 4 decimals (the geofence has no linked-location FK). */
  center?: string;
  status: string;
};

export type JurisdictionRow = {
  id: string;
  level: string;
  /** Resolved office name; "" when the name could not be resolved (never a raw id). */
  office: string;
  /** Resolved administrative-unit name; "" when it could not be resolved. */
  unit: string;
  primary?: boolean;
};

/** A row of the /locations/list register (GAP-LOCATIONS-LIST-02). */
export type LocationRow = {
  id: string;
  name: string;
  type: string;
  parentName: string;
  lgdCode: string;
  status: string;
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
    const assetId = toText(row.assetId);
    out.push({
      id: toText(row.id) ?? `row-${i + 1}`,
      name: toText(row.name) ?? "—",
      type: toText(row.type) ?? "—",
      condition: score !== undefined ? `${score}/5` : "—",
      status: toText(row.status) ?? "—",
      ...(assetId ? { assetId } : {}),
    });
  }
  return out;
}

function formatCentre(lat: unknown, lng: unknown): string {
  const la = toNum(lat);
  const ln = toNum(lng);
  return la !== undefined && ln !== undefined ? `${la.toFixed(4)}, ${ln.toFixed(4)}` : "—";
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
      center: formatCentre(row.centerLat, row.centerLng),
      status: active === false ? "inactive" : active === true ? "active" : (toText(row.status) ?? "—"),
    });
  }
  return out;
}

type NameIndex = Map<string, string>;

/** Flattens a `{ id, name, children? }` tree (or flat list) into an id -> name index. */
function indexNames(payload: unknown, into: NameIndex = new Map()): NameIndex {
  for (const row of extractRows(payload)) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    if (id && name) into.set(id, name);
    if (Array.isArray(row.children)) indexNames(row.children, into);
  }
  return into;
}

function mapJurisdictions(payload: unknown, names: NameIndex): JurisdictionRow[] {
  const out: JurisdictionRow[] = [];
  for (const [i, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const officeId = toText(row.officeId);
    const unitId = toText(row.unitId);
    out.push({
      id: toText(row.id) ?? `row-${i + 1}`,
      level: toText(row.level) ?? "—",
      // The register stores ids; show names, never the raw id. Unresolved -> "".
      office: (officeId && names.get(officeId)) || "",
      unit: (unitId && names.get(unitId)) || "",
      primary: row.isPrimary === true,
    });
  }
  return out;
}

function mapLocations(payload: unknown): LocationRow[] {
  const raw = extractRows(payload).filter(isRecord);
  const nameById = new Map<string, string>();
  for (const r of raw) {
    const id = toText(r.id);
    const name = toText(r.name);
    if (id && name) nameById.set(id, name);
  }
  return raw.map((r, i) => {
    const parentId = toText(r.parentId);
    return {
      id: toText(r.id) ?? `row-${i + 1}`,
      name: toText(r.name) ?? "—",
      type: toText(r.type) ?? "—",
      parentName: (parentId && nameById.get(parentId)) || "",
      lgdCode: toText(r.lgdCode) ?? "",
      status: toText(r.status) ?? "active",
    };
  });
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

export async function getLocationJurisdictionsTyped(): Promise<LoaderResult<JurisdictionRow[]>> {
  // Name lookups are best-effort: a failure leaves the names unresolved
  // (shown as "Not available") but never fails the register itself.
  const [main, units, offices] = await Promise.all([
    fetchJson<unknown, unknown>("/api/v1/jurisdictions", [], {
      revalidateSeconds: 30,
      telemetryKey: "locations.jurisdictions.typed",
      mapResponse: (p) => p,
    }),
    fetchJson<unknown, NameIndex>("/api/v1/hierarchy", new Map(), {
      revalidateSeconds: 60,
      telemetryKey: "locations.jurisdictions.units",
      mapResponse: (p) => indexNames(p),
    }),
    fetchJson<unknown, NameIndex>("/api/v1/locations?limit=500", new Map(), {
      revalidateSeconds: 60,
      telemetryKey: "locations.jurisdictions.offices",
      mapResponse: (p) => indexNames(p),
    }),
  ]);
  const names: NameIndex = new Map([...offices.data, ...units.data]);
  const { data, ...rest } = main;
  return { ...rest, data: mapJurisdictions(data, names) };
}

/** Typed loader for the /locations/list register (name, type, parent, LGD code, status). */
export function getLocationsTyped(): Promise<LoaderResult<LocationRow[]>> {
  return fetchJson<unknown, LocationRow[]>("/api/v1/locations?limit=500", [], {
    revalidateSeconds: 30,
    telemetryKey: "locations.list.typed",
    mapResponse: mapLocations,
  });
}

export type AssetLinkOption = { id: string; label: string };

function mapAssetOptions(payload: unknown): AssetLinkOption[] {
  const out: AssetLinkOption[] = [];
  for (const row of extractRows(payload)) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    if (!id || !name) continue;
    const code = toText(row.code);
    out.push({ id, label: code ? `${name} (${code})` : name });
  }
  return out;
}

/** Asset-register records an infrastructure asset can be linked to (GAP-LOCATIONS-INFRASTRUCTURE-06). */
export function getAssetLinkOptions(): Promise<LoaderResult<AssetLinkOption[]>> {
  return fetchJson<unknown, AssetLinkOption[]>("/api/v1/assets/assets?limit=200", [], {
    revalidateSeconds: 60,
    telemetryKey: "locations.infrastructure.assetOptions",
    mapResponse: mapAssetOptions,
  });
}

/** A record picked by name in a form; the id is what is sent, the label is what the user sees. */
export type NameOption = { id: string; label: string };

function flattenNames(payload: unknown, out: NameOption[] = []): NameOption[] {
  for (const row of extractRows(payload)) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    if (id && name && toText(row.status) !== "archived") out.push({ id, label: name });
    if (Array.isArray(row.children)) flattenNames(row.children, out);
  }
  return out;
}

/**
 * Options for the assign-jurisdiction form (GAP-LOCATIONS-JURISDICTIONS-02): the offices register and the
 * administrative hierarchy, both by name. `source` is "error" if either could not be read, so the page can
 * leave the form out rather than offer an empty picker.
 */
export async function getJurisdictionFormOptions(): Promise<LoaderResult<{ offices: NameOption[]; units: NameOption[] }>> {
  const [offices, units] = await Promise.all([
    fetchJson<unknown, NameOption[]>("/api/v1/locations?limit=500", [], {
      revalidateSeconds: 30,
      telemetryKey: "locations.jurisdictions.formOffices",
      mapResponse: (p) => flattenNames(p),
    }),
    fetchJson<unknown, NameOption[]>("/api/v1/hierarchy", [], {
      revalidateSeconds: 30,
      telemetryKey: "locations.jurisdictions.formUnits",
      mapResponse: (p) => flattenNames(p),
    }),
  ]);
  const failed = offices.source === "error" ? offices : units.source === "error" ? units : null;
  return {
    data: { offices: offices.data, units: units.data },
    source: failed ? "error" : offices.source,
    ...(failed?.status !== undefined ? { status: failed.status } : {}),
  };
}
