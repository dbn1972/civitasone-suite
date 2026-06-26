/**
 * grants/_data.ts — server-side loaders specific to the grants upstream workflow.
 *
 * Follows the pattern in apps/web/src/app/_data/loaders.ts.
 * fetchJson hits the gateway; on error it returns empty data + source:"error".
 */

import { fetchJson } from "@/app/_data/apiClient";
import type { LoaderResult } from "@/app/_data/apiClient";

// ──────────────────────────────────────────────────────────────────────────────
// Types (inferred from grant-service schema + queries)
// ──────────────────────────────────────────────────────────────────────────────

export type GrantSchemeSummary = {
  /** uuid */
  id: string;
  /** Short code, e.g. "PM-KISAN-2024" */
  code: string;
  name: string;
  /** Budget in minor units (paise). API returns as number after JSON parse. */
  budgetMinor: number;
  disbursedMinor: number;
  currency: string;
  status: "draft" | "open" | "closed" | "completed" | "cancelled";
  /** ISO timestamps, may be absent */
  openAt?: string | null;
  closeAt?: string | null;
  /** Applications in this scheme — API may or may not return this. Default 0. */
  applicationCount: number;
};

export type GrantApplicationSummary = {
  /** uuid */
  id: string;
  /** Human-readable grant number, e.g. "G-2024-0001" */
  grantNo: string;
  /** Application title / purpose */
  title: string;
  /** Beneficiary name */
  granteeName?: string;
  /** Amount approved or requested, in minor units */
  totalAmount: number;
  disbursedAmount: number;
  pendingAmount: number;
  sanctionDate: string;
  purpose?: string;
  status: "active" | "completed" | "suspended" | "cancelled";
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getArrayPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as unknown[];
  if (isRecord(payload) && Array.isArray(payload.items)) return payload.items as unknown[];
  return null;
}

function toText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mappers
// ──────────────────────────────────────────────────────────────────────────────

function mapGrantSchemeSummaries(payload: unknown): GrantSchemeSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const out: GrantSchemeSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const code = toText(row.code);
    const name = toText(row.name);
    const status = toText(row.status) ?? "draft";
    if (!id || !code || !name) continue;

    const validStatuses = ["draft", "open", "closed", "completed", "cancelled"] as const;
    const safeStatus = validStatuses.includes(status as typeof validStatuses[number])
      ? (status as GrantSchemeSummary["status"])
      : "draft";

    out.push({
      id,
      code,
      name,
      budgetMinor: toNumber(row.budgetMinor ?? row.budget_minor),
      disbursedMinor: toNumber(row.disbursedMinor ?? row.disbursed_minor),
      currency: toText(row.currency) ?? "INR",
      status: safeStatus,
      openAt: toText(row.openAt ?? row.open_at),
      closeAt: toText(row.closeAt ?? row.close_at),
      applicationCount: toNumber(row.applicationCount ?? row.application_count ?? row.projectCount),
    });
  }
  return out.length > 0 ? out : [];
}

function mapGrantApplicationSummaries(payload: unknown): GrantApplicationSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const out: GrantApplicationSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const grantNo = toText(row.grantNo ?? row.grant_no);
    const title = toText(row.title ?? row.purpose);
    if (!id || !grantNo || !title) continue;

    const rawStatus = toText(row.status) ?? "active";
    const validStatuses = ["active", "completed", "suspended", "cancelled"] as const;
    const safeStatus = validStatuses.includes(rawStatus as typeof validStatuses[number])
      ? (rawStatus as GrantApplicationSummary["status"])
      : "active";

    out.push({
      id,
      grantNo,
      title,
      granteeName: toText(row.granteeName ?? row.grantee_name) ?? undefined,
      totalAmount: toNumber(row.totalAmount ?? row.total_amount),
      disbursedAmount: toNumber(row.disbursedAmount ?? row.disbursed_amount),
      pendingAmount: toNumber(row.pendingAmount ?? row.pending_amount),
      sanctionDate: toText(row.sanctionDate ?? row.sanction_date ?? row.approvedAt) ?? new Date().toISOString(),
      purpose: toText(row.purpose) ?? undefined,
      status: safeStatus,
    });
  }
  return out.length > 0 ? out : [];
}

// ──────────────────────────────────────────────────────────────────────────────
// Loaders
// ──────────────────────────────────────────────────────────────────────────────

export async function getGrantSchemes(): Promise<LoaderResult<GrantSchemeSummary[]>> {
  return fetchJson<unknown, GrantSchemeSummary[]>("/api/v1/grants/schemes", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.schemes",
    mapResponse: mapGrantSchemeSummaries,
  });
}

export async function getGrantApplications(): Promise<LoaderResult<GrantApplicationSummary[]>> {
  return fetchJson<unknown, GrantApplicationSummary[]>("/api/v1/grants/grants", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.applications",
    mapResponse: mapGrantApplicationSummaries,
  });
}
