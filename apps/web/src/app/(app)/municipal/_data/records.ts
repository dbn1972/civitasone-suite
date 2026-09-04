import type { MunicipalServiceConfig } from "./services";

export type MunicipalRecordRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  updatedAt: string;
};

export type MunicipalListMeta = {
  page: number;
  pageSize: number;
  total: number;
};

export type MunicipalListResult = {
  rows: MunicipalRecordRow[];
  meta: MunicipalListMeta;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function formatJsonTitle(v: unknown): string | null {
  if (!isRecord(v)) return null;
  if (typeof v.address === "string" && v.address.trim()) return v.address.trim();
  if (typeof v.line1 === "string" && v.line1.trim()) {
    const parts = [v.line1, v.city].filter((p) => typeof p === "string" && p.trim());
    return parts.join(", ");
  }
  return null;
}

export function pickField(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const raw = row[key];
    const direct = asString(raw);
    if (direct) return direct;
    const fromJson = formatJsonTitle(raw);
    if (fromJson) return fromJson;
  }
  return "—";
}

export function toMunicipalRecordRow(
  raw: unknown,
  config: MunicipalServiceConfig,
): MunicipalRecordRow | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;

  return {
    id,
    reference: pickField(raw, config.numberFields),
    title: pickField(raw, config.titleFields),
    status: pickField(raw, ["status"]),
    updatedAt: pickField(raw, ["updatedAt", "submittedAt", "createdAt"]),
  };
}

export function parseListPayload(raw: unknown, config: MunicipalServiceConfig): MunicipalListResult {
  const empty: MunicipalListResult = {
    rows: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  };
  if (!isRecord(raw)) return empty;

  const data = Array.isArray(raw.data) ? raw.data : Array.isArray(raw) ? raw : [];
  const meta = isRecord(raw.meta) ? raw.meta : {};

  const rows = data
    .map((item) => toMunicipalRecordRow(item, config))
    .filter((r): r is MunicipalRecordRow => r !== null);

  return {
    rows,
    meta: {
      page: typeof meta.page === "number" ? meta.page : 1,
      pageSize: typeof meta.pageSize === "number" ? meta.pageSize : rows.length || 20,
      total: typeof meta.total === "number" ? meta.total : rows.length,
    },
  };
}

export function parseDetailPayload(raw: unknown, config: MunicipalServiceConfig): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.data)) return raw.data;
  return raw;
}

/** Flatten record for read-only detail panel (primitives only, nested as JSON strings). */
export function detailEntries(record: Record<string, unknown>): { label: string; value: string }[] {
  const skip = new Set(["tenantId", "createdBy", "updatedBy", "version"]);
  return Object.entries(record)
    .filter(([k]) => !skip.has(k))
    .map(([key, value]) => ({
      label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      value: formatDetailValue(value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function formatDetailValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
