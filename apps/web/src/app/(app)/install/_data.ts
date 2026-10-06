/**
 * install route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls install-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/;

// GAP-INSTALL-{MODULES,SILOS,STAGES}-01 (FORMAT): a timestamp folded into the
// `meta` column used to render as a raw ISO string ("2026-03-01T10:00:00Z").
// Format any ISO-shaped value as an Indian date so the Meta column reads as a
// date, not machine text. Non-date meta (a code/currency) passes through.
function formatMetaValue(value: string): string {
  return ISO_DATE_RE.test(value) ? formatIndianDate(value) : value;
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

export function mapRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.code) ??
      toText(row.id) ??
      toText(row.key) ??
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
    const metaRaw =
      toText(row.code) ??
      toText(row.currency) ??
      toText(row.updatedAt) ??
      toText(row.createdAt) ??
      (typeof row.points === "number" ? `${row.points} pts` : undefined) ??
      (typeof row.balance === "number" ? `bal ${row.balance}` : undefined);
    const meta = metaRaw ? formatMetaValue(metaRaw) : undefined;
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

/**
 * GAP-INSTALL-MODULES-04 (CONTENT): /api/v1/install/modules returns the module
 * manifest (ModuleDef: id/name/description/requires/foundation/subModules).
 * The generic mapper dropped `requires` and `foundation`, so the "Module
 * resolution catalogue" showed no dependency or always-on information at all.
 * This dedicated mapper surfaces the REAL manifest fields (no invented
 * edition/entitlement columns — those do not exist in the contract): the
 * description as the detail, "Always on" vs "Optional" as the status, and the
 * dependency list (or sub-module count) as the meta. Falls back to the generic
 * mapper for any payload that is not the manifest shape.
 */
export function mapInstallModules(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const looksLikeManifest = rows.some((r) => isRecord(r) && Array.isArray((r as Record<string, unknown>).requires));
  if (!looksLikeManifest) return mapRows(payload);

  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.name) ?? `module-${index + 1}`;
    const label = toText(row.name) ?? id;
    const requires = Array.isArray(row.requires)
      ? row.requires.filter((d): d is string => typeof d === "string")
      : [];
    const subCount = Array.isArray(row.subModules) ? row.subModules.length : 0;
    const foundation = row.foundation === true;
    const metaParts: string[] = [];
    if (requires.length > 0) metaParts.push(`Requires: ${requires.join(", ")}`);
    else if (subCount > 0) metaParts.push(`${subCount} sub-module${subCount === 1 ? "" : "s"}`);
    mapped.push({
      id,
      label,
      ...(toText(row.description) ? { sublabel: toText(row.description) } : {}),
      status: foundation ? "Always on" : "Optional",
      ...(metaParts.length > 0 ? { meta: metaParts.join(" · ") } : {}),
    });
  }
  return mapped;
}

function installModulesLoader() {
  return fetchJson<unknown, ModuleRowSummary[]>("/api/v1/install/modules", [] as ModuleRowSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "install.modules",
    mapResponse: mapInstallModules,
  });
}

export const getInstallStages = moduleLoader("/api/v1/install/stages", "install.stages");
export const getInstallSteps = moduleLoader("/api/v1/install/steps", "install.steps");
export const getInstallModules = installModulesLoader;
export const getInstallSilos = moduleLoader("/api/v1/install/silo-provisions", "install.silos");
