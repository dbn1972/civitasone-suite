/**
 * theme route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls theme-service through the gateway via cookie-aware fetchJson.
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
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName) ??
      toText(row.agentId) ??
      toText(row.profileId);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycle);
    // GAP-THEMES-BRAND-02 / GAP-THEMES-BRANDING-01: date-like meta (updatedAt/
    // createdAt) is formatted to the tenant-locale IST date (CLAUDE.md
    // timestamps rule) instead of a raw ISO string; code/currency keep priority.
    const dateMeta = toText(row.updatedAt) ?? toText(row.createdAt);
    const meta =
      toText(row.code) ??
      toText(row.currency) ??
      (dateMeta ? formatIndianDate(dateMeta) : undefined) ??
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

export const getThemeTemplates = moduleLoader("/api/v1/themes/templates", "themes.templates");
export const getThemeBranding = moduleLoader("/api/v1/themes/branding", "themes.branding");
export const getThemeBrand = moduleLoader("/api/v1/themes/brand", "themes.brand");

/* ── GAP-THEMES-BRAND-01: brand preview + activation ──────────────────────
 * The /themes/brand page previously rendered presets as plain text rows with
 * no colour/logo preview and no activate control. These typed loaders feed a
 * real BrandPreview (colour swatches + logo + an active StatusPill) and the
 * preset gallery whose Activate control POSTs the audited
 * /v1/themes/brand/apply-preset endpoint (theme-service, admin-gated + audit).
 */
export interface BrandConfigView {
  appName: string;
  logoUrl: string | null;
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  colorBackground: string;
  colorSurface: string;
  colorText: string;
  colorPrimaryFg: string;
}

export interface BrandPresetView {
  code: string;
  name: string;
  description: string | null;
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  colorBackground: string;
  colorSurface: string;
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}

function mapBrandConfig(payload: unknown): BrandConfigView | null {
  if (!isRecord(payload)) return null;
  // GET /v1/themes/brand returns the config object directly (or defaults).
  const src = isRecord(payload.data) ? payload.data : payload;
  return {
    appName: toText(src.appName) ?? "CivitasOne",
    logoUrl: toText(src.logoUrl) ?? null,
    colorPrimary: hex(src.colorPrimary, "#1e40af"),
    colorSecondary: hex(src.colorSecondary, "#64748b"),
    colorAccent: hex(src.colorAccent, "#f59e0b"),
    colorBackground: hex(src.colorBackground, "#ffffff"),
    colorSurface: hex(src.colorSurface, "#f8fafc"),
    colorText: hex(src.colorText, "#1e293b"),
    colorPrimaryFg: hex(src.colorPrimaryFg, "#ffffff"),
  };
}

function mapBrandPresets(payload: unknown): BrandPresetView[] {
  const out: BrandPresetView[] = [];
  for (const row of extractRows(payload)) {
    if (!isRecord(row)) continue;
    const code = toText(row.code);
    if (!code) continue;
    out.push({
      code,
      name: toText(row.name) ?? code,
      description: toText(row.description) ?? null,
      colorPrimary: hex(row.colorPrimary, "#1e40af"),
      colorSecondary: hex(row.colorSecondary, "#64748b"),
      colorAccent: hex(row.colorAccent, "#f59e0b"),
      colorBackground: hex(row.colorBackground, "#ffffff"),
      colorSurface: hex(row.colorSurface, "#f8fafc"),
    });
  }
  return out;
}

export function getThemeBrandConfig(): Promise<LoaderResult<BrandConfigView | null>> {
  return fetchJson<unknown, BrandConfigView | null>("/api/v1/themes/brand", null, {
    revalidateSeconds: 30,
    telemetryKey: "themes.brand-config",
    mapResponse: mapBrandConfig,
  });
}

export function getThemeBrandPresets(): Promise<LoaderResult<BrandPresetView[]>> {
  return fetchJson<unknown, BrandPresetView[]>("/api/v1/themes/brand/presets", [], {
    revalidateSeconds: 30,
    telemetryKey: "themes.brand-presets",
    mapResponse: mapBrandPresets,
  });
}
