import type { MunicipalServiceConfig } from "./services";
import { formatIndianDate, formatIndianDateTime } from "@/lib/formatters";

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

export function parseDetailPayload(raw: unknown, _config: MunicipalServiceConfig): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.data)) return raw.data;
  return raw;
}

/**
 * GAP-MUNICIPAL-SERVICEKEY-02: status groups shared by the service home and
 * applications pages so "In progress" counting is consistent and does not
 * mislead officers.
 *
 * TERMINAL_STATUSES are states where no further officer action is pending —
 * both positive terminals (approved/issued/…) and negative terminals
 * (rejected/cancelled/expired). A record is "in progress" only when it is in
 * neither a terminal state nor an unknown/placeholder ("—") state. This is a
 * deliberate contract change from the old inline list, which counted every
 * non-positive status (including rejected/cancelled/expired and "—") as in
 * progress.
 */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  // positive terminals
  "approved",
  "issued",
  "completed",
  "closed",
  "resolved",
  // negative terminals
  "rejected",
  "cancelled",
  "canceled",
  "expired",
  "withdrawn",
]);

/** True when a status represents work still pending an officer (not terminal, not unknown). */
export function isInProgressStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  if (!s || s === "—") return false;
  return !TERMINAL_STATUSES.has(s);
}

/** Count of rows still in progress among the given (page-scoped) rows. */
export function countInProgress(rows: readonly MunicipalRecordRow[]): number {
  return rows.filter((r) => isInProgressStatus(r.status)).length;
}

export type MunicipalDetailKind = "text" | "nested" | "pii";
export type MunicipalPiiKind = "phone" | "email" | "pan" | "account";

export type MunicipalDetailEntry = {
  key: string;
  label: string;
  /** Pre-formatted display string for plain text/nested values. */
  value: string;
  kind: MunicipalDetailKind;
  /** For kind === "pii": which mask to apply, and the raw value to mask. */
  piiKind?: MunicipalPiiKind;
  rawValue?: string;
};

// GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01: keys we never render — the
// internal record id (reference is shown instead), audit/system columns, and
// anything a service owner marks hiddenFields. Document/identity NUMBERS are
// masked rather than hidden so an officer can still verify the last digits.
const ALWAYS_SKIP = new Set(["id", "tenantId", "createdBy", "updatedBy", "version"]);

// Key-name heuristics so a service that has not yet filled piiFields still
// masks obvious PII by default (fail-closed).
function piiKindForKey(key: string): MunicipalPiiKind | null {
  const k = key.toLowerCase();
  if (/(^|_)(mobile|phone|contact|whatsapp|tel)(number)?$/.test(k) || k.includes("phone") || k.includes("mobile")) return "phone";
  if (k.includes("email")) return "email";
  if (k.includes("aadhaar") || k.includes("aadhar")) return "account";
  if (k === "pan" || k.endsWith("pan") || k.includes("pannumber") || k.includes("pan_no")) return "pan";
  if (k.includes("account") || k.includes("bankacc")) return "account";
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

/**
 * Flatten a record for the read-only detail panel.
 *
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-01: identity/contact fields are
 * returned as `kind: "pii"` with a mask kind so the panel renders them masked
 * by default; `hiddenFields` are dropped entirely.
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: ISO timestamps are formatted
 * for display, nested objects become `kind: "nested"` key/value blocks, the
 * internal `id` is skipped, and ordering follows the service's `fieldOrder`
 * then alphabetical.
 */
export function detailEntries(
  record: Record<string, unknown>,
  config?: MunicipalServiceConfig,
): MunicipalDetailEntry[] {
  const hidden = new Set([...ALWAYS_SKIP, ...((config?.hiddenFields ?? []) as string[])]);
  const explicitPii = new Set((config?.piiFields ?? []) as string[]);
  const order = (config?.fieldOrder ?? []) as string[];

  const entries: MunicipalDetailEntry[] = Object.entries(record)
    .filter(([k]) => !hidden.has(k))
    .map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
      const piiKind = explicitPii.has(key) ? (piiKindForKey(key) ?? "account") : piiKindForKey(key);
      const rawString = typeof value === "string" ? value : typeof value === "number" ? String(value) : null;

      if (piiKind && rawString) {
        return { key, label, value: rawString, kind: "pii" as const, piiKind, rawValue: rawString };
      }
      if (isRecord(value) || Array.isArray(value)) {
        return { key, label, value: formatNested(value), kind: "nested" as const };
      }
      return { key, label, value: formatDetailValue(value), kind: "text" as const };
    });

  const orderIndex = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  return entries.sort((a, b) => {
    const oa = orderIndex(a.key);
    const ob = orderIndex(b.key);
    if (oa !== ob) return oa - ob;
    return a.label.localeCompare(b.label);
  });
}

/** Nested object/array → readable "key: value" lines (not raw JSON braces). */
function formatNested(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => formatDetailValue(v)).join(", ");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([k, v]) => {
        const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        return `${label}: ${formatDetailValue(v)}`;
      })
      .join("\n");
  }
  return formatDetailValue(value);
}

function formatDetailValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    // GAP-...-DETAIL-03: render ISO date/timestamp strings as a formatted IST date.
    if (ISO_DATE_RE.test(value)) {
      const formatted = value.includes("T") ? formatIndianDateTime(value) : formatIndianDate(value);
      if (formatted !== "—") return formatted;
    }
    return value;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (isRecord(value) || Array.isArray(value)) return formatNested(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
