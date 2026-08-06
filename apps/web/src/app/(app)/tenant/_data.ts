/**
 * tenant route-group server loaders. Call tenant-service through the gateway
 * (/api/v1/tenant/* → upstream /v1/*) using the shared cookie-aware fetchJson helper.
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
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.resources)) return payload.resources;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.domains)) return payload.domains;
  if (Array.isArray(payload.assets)) return payload.assets;
  if (Array.isArray(payload.requests)) return payload.requests;
  if (Array.isArray(payload.values)) return payload.values;
  if (isRecord(payload.data)) return [payload.data];
  return [payload];
}

function mapTenantRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.id) ??
      toText(row.resource) ??
      toText(row.key) ??
      toText(row.code) ??
      toText(row.planId) ??
      toText(row.subscriptionId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.label) ??
      toText(row.key) ??
      toText(row.resource) ??
      toText(row.code) ??
      toText(row.domain) ??
      id;
    const sublabel =
      toText(row.description) ??
      toText(row.type) ??
      toText(row.category) ??
      toText(row.planName) ??
      toText(row.value);
    const status = toText(row.status) ?? toText(row.state);
    const meta =
      toText(row.code) ??
      toText(row.unit) ??
      (typeof row.usagePercent === "number" ? `${row.usagePercent}%` : undefined) ??
      (typeof row.limit === "number" ? `limit ${row.limit}` : undefined) ??
      toText(row.currency);
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

function tenantLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapTenantRows,
    });
}

/** Core tenant profile (11th backend module). */
export const getTenantOverview = tenantLoader("/api/v1/tenant/tenants/current", "tenant.overview");
export const getTenantQuotas = tenantLoader("/api/v1/tenant/tenant/usage", "tenant.quotas");
export const getTenantSettings = tenantLoader("/api/v1/tenant/settings", "tenant.settings");
export const getTenantOrgHierarchy = tenantLoader("/api/v1/tenant/org/hierarchy", "tenant.org-hierarchy");
export const getTenantSubscriptions = tenantLoader(
  "/api/v1/tenant/subscriptions/current",
  "tenant.subscriptions",
);
export const getTenantCodeLists = tenantLoader("/api/v1/tenant/code-lists", "tenant.code-lists");
export const getTenantPositions = tenantLoader("/api/v1/tenant/positions", "tenant.positions");
export const getTenantConsentExchange = tenantLoader(
  "/api/v1/tenant/consent/requests",
  "tenant.consent-exchange",
);
export const getTenantStewardship = tenantLoader(
  "/api/v1/tenant/data-governance/domains",
  "tenant.stewardship",
);
export const getTenantDataMigration = tenantLoader(
  "/api/v1/tenant/org/migrations",
  "tenant.data-migration",
);
export const getTenantPlans = tenantLoader("/api/v1/tenant/plans", "tenant.plans");
