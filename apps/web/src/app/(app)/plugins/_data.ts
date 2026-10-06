/**
 * plugin route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls plugin-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import { z } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * GAP-PLUGINS-HOOKS-03 / MARKETPLACE-04 / REGISTRY-03: a non-array payload with
 * a recognised array key ("data", "items", …) yields that array; a single
 * nested `data` object yields that one object. Anything else — in particular a
 * bare error-shaped object like `{ error, message }` returned with HTTP 200 —
 * yields `[]` (NOT `[payload]`), so an error body never becomes a bogus "row".
 * `mapRows` turns that empty result into a null mapResponse (source: "error").
 */
function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) return [payload.data];
  return [];
}

/**
 * Returns null when the payload shape is unrecognised (no array key and not an
 * array), so `fetchJson` reports `source: "error"` and the page can render a
 * RefreshErrorState instead of an empty table that hides a real failure.
 * An array/known-array-key payload that is genuinely empty still maps to `[]`
 * (a real "nothing here" result), which is distinct from `null`.
 */
function mapRows(payload: unknown): ModuleRowSummary[] | null {
  if (!Array.isArray(payload) && !isRecord(payload)) return null;
  if (isRecord(payload)) {
    const hasArrayKey =
      ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"].some(
        (key) => Array.isArray((payload as Record<string, unknown>)[key]),
      ) || isRecord((payload as Record<string, unknown>).data);
    if (!hasArrayKey) return null;
  }
  const mapped: ModuleRowSummary[] = [];
  for (const row of extractRows(payload)) {
    if (!isRecord(row)) continue;
    // GAP-PLUGINS-HOOKS-03: no synthetic `row-N` id — a row with no real
    // identifier is skipped rather than given a fabricated key.
    const id =
      toText(row.id) ??
      toText(row.key) ??
      toText(row.code) ??
      toText(row.name) ??
      toText(row.agentId) ??
      toText(row.profileId) ??
      toText(row.accountId) ??
      toText(row.conversationId);
    if (!id) continue;
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

export const getPluginItems = moduleLoader("/api/v1/plugins/items", "plugins.items");
export const getPluginRegistry = moduleLoader("/api/v1/plugins", "plugins.registry");
export const getPluginMarketplace = moduleLoader("/api/v1/plugins/marketplace", "plugins.marketplace");
export const getPluginHooks = moduleLoader("/api/v1/plugins/hooks", "plugins.hooks");

/* -------------------------------------------------------------------------- */
/* GAP-PLUGINS-HOOKS-02 / MARKETPLACE-03 / REGISTRY-02 (theme UUID): typed,    */
/* zod-validated mappers so the catalogue/hooks tables keep plugin-specific    */
/* columns (name, publisher, version, status, updatedAt) instead of the        */
/* generic ID/Name/Detail/Status/Meta row. Fields the plugin-service does not  */
/* send are simply absent (optional); nothing is fabricated.                   */
/* -------------------------------------------------------------------------- */

/** A plugin catalogue row (installed / registry / marketplace share the shape). */
export type PluginCatalogRow = {
  id: string;
  name: string;
  status?: string;
  version?: string;
  publisher?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

/** A plugin hook row with its owning plugin and lifecycle state. */
export type PluginHookRow = {
  id: string;
  event: string;
  ownerPlugin?: string;
  status: string;
  failures?: number;
  lastRun?: string;
  [key: string]: unknown;
};

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** Pull a value out of a (possibly nested manifest) record. */
function fromManifest(row: Record<string, unknown>, key: string): unknown {
  if (row[key] !== undefined) return row[key];
  const manifest = row.manifestJson ?? row.manifest;
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    return (manifest as Record<string, unknown>)[key];
  }
  return undefined;
}

const unknownRecord = z.record(z.unknown());
const catalogEnvelope = z.union([
  z.array(unknownRecord),
  z.object({ data: z.array(unknownRecord) }),
  z.object({ items: z.array(unknownRecord) }),
]);

/** Normalise a parsed envelope (array | {data} | {items}) to a row array. */
function rowsFromEnvelope(
  parsed: z.infer<typeof catalogEnvelope>,
): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed;
  if ("data" in parsed) return parsed.data;
  return parsed.items;
}

function mapCatalog(payload: unknown): PluginCatalogRow[] | null {
  const parsed = catalogEnvelope.safeParse(payload);
  if (!parsed.success) return null;
  const rows = rowsFromEnvelope(parsed.data);
  const mapped: PluginCatalogRow[] = [];
  for (const row of rows) {
    const id = pickString(row.id, row.key, row.code);
    if (!id) continue;
    const name = pickString(fromManifest(row, "name"), row.title, row.label) ?? id;
    const status = pickString(row.status, row.state, row.lifecycle);
    const version = pickString(fromManifest(row, "version"), row.semver);
    const publisher = pickString(fromManifest(row, "publisher"), fromManifest(row, "author"), row.vendor);
    const updatedAt = pickString(row.updatedAt, row.installedAt, row.createdAt);
    mapped.push({
      id,
      name,
      ...(status ? { status } : {}),
      ...(version ? { version } : {}),
      ...(publisher ? { publisher } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  return mapped;
}

function mapHooks(payload: unknown): PluginHookRow[] | null {
  const parsed = catalogEnvelope.safeParse(payload);
  if (!parsed.success) return null;
  const rows = rowsFromEnvelope(parsed.data);
  const mapped: PluginHookRow[] = [];
  for (const row of rows) {
    const id = pickString(row.id);
    if (!id) continue;
    const event = pickString(row.eventType, row.event, row.name) ?? "—";
    const ownerPlugin = pickString(row.pluginName, row.ownerPlugin, row.pluginId);
    // `active` boolean -> enabled/disabled; a raw status string wins if present.
    const status =
      pickString(row.status) ??
      (typeof row.active === "boolean" ? (row.active ? "enabled" : "disabled") : undefined) ??
      "unknown";
    const failures = typeof row.failures === "number" ? row.failures : typeof row.failureCount === "number" ? row.failureCount : undefined;
    const lastRun = pickString(row.lastRun, row.lastRunAt, row.lastInvokedAt);
    mapped.push({
      id,
      event,
      ...(ownerPlugin ? { ownerPlugin } : {}),
      status,
      ...(failures !== undefined ? { failures } : {}),
      ...(lastRun ? { lastRun } : {}),
    });
  }
  return mapped;
}

function typedLoader<T>(path: string, key: string, mapper: (p: unknown) => T[] | null) {
  return (): Promise<LoaderResult<T[]>> =>
    fetchJson<unknown, T[]>(path, [] as T[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapper,
    });
}

export const getPluginRegistryCatalog = typedLoader<PluginCatalogRow>("/api/v1/plugins", "plugins.registry", mapCatalog);
export const getPluginMarketplaceCatalog = typedLoader<PluginCatalogRow>("/api/v1/plugins/marketplace", "plugins.marketplace", mapCatalog);
export const getPluginHooksTyped = typedLoader<PluginHookRow>("/api/v1/plugins/hooks", "plugins.hooks", mapHooks);

// Exported for unit tests (GAP-PLUGINS-HOOKS-02/03, MARKETPLACE-03/04, REGISTRY-02/03).
export const __test = { mapRows, mapCatalog, mapHooks };
