/**
 * Pure view-model helpers for /admin/entitlements.
 * GAP-ADMIN-ENTITLEMENTS-04/05/06/07.
 */
export type EntitlementRow = {
  module: string;
  edition: string;
  tenant: string;
  limit: string;
  used: string;
  /** Display text for the Used / Limit cell, e.g. "100 / 100" or "12 / unlimited". */
  usage: string;
  /** Over/near-limit flag; text-based so it is never colour-only. */
  limitState: "over" | "near" | "ok";
  /** 0-100 percent of the limit consumed; null when there is no numeric cap. */
  usedPct: number | null;
  status: string;
};

function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** A numeric cap, or null for unlimited / unset / non-numeric ("unlimited", null, "-"). */
export function parseCap(v: unknown): number | null {
  const s = text(v);
  if (s === "" || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

function parseUsed(v: unknown): number | null {
  const s = text(v);
  if (s === "" || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function toEntitlementRow(raw: Record<string, unknown>): EntitlementRow {
  const cap = parseCap(raw.limit);
  const used = parseUsed(raw.used);
  const usedPct = cap !== null && used !== null ? (used / cap) * 100 : null;
  const limitState: EntitlementRow["limitState"] =
    usedPct === null ? "ok" : usedPct >= 100 ? "over" : usedPct >= 90 ? "near" : "ok";
  const limitText = text(raw.limit);
  const usedText = used === null ? "" : String(used);
  return {
    module: text(raw.module),
    edition: text(raw.edition),
    tenant: text(raw.tenant),
    limit: limitText,
    used: usedText,
    usage: usedText === "" ? "—" : `${usedText} / ${cap === null ? (limitText || "unlimited") : limitText}`,
    limitState,
    usedPct,
    status: text(raw.status),
  };
}

export type EntitlementSummary = {
  total: number;
  active: number;
  revoked: number;
  /** Neither active nor revoked: expired, suspended, draft, trial, ... */
  otherInactive: number;
  /** Distinct non-empty editions (trimmed). */
  editions: number;
  /** Rows at or above their numeric cap. */
  atLimit: number;
};

export function summarizeEntitlements(rows: EntitlementRow[]): EntitlementSummary {
  const lower = (r: EntitlementRow) => r.status.toLowerCase();
  const active = rows.filter((r) => lower(r) === "active").length;
  const revoked = rows.filter((r) => lower(r) === "revoked").length;
  return {
    total: rows.length,
    active,
    revoked,
    otherInactive: rows.length - active - revoked,
    editions: new Set(rows.map((r) => r.edition).filter(Boolean)).size,
    atLimit: rows.filter((r) => r.limitState === "over").length,
  };
}
