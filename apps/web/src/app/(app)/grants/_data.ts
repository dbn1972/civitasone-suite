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
  /**
   * GAP-GRANTS-SCHEMES-05: an unknown/unexpected backend status is surfaced as
   * "unknown" (StatusPill renders it, humanized, as a neutral pill) rather than
   * being silently rewritten to "draft" — a malformed scheme must not be
   * mislabelled as a real draft.
   */
  status: "draft" | "open" | "closed" | "completed" | "cancelled" | "unknown";
  /** ISO timestamps, may be absent */
  openAt?: string | null;
  closeAt?: string | null;
  /**
   * GAP-GRANTS-SCHEMES-04: applications in this scheme. `null` when the API
   * returned no application count at all — rendered as "—", never a fabricated
   * 0 and never silently substituted from projectCount (whose meaning the
   * grant-service contract does not define as "applications").
   */
  applicationCount: number | null;
};

/**
 * GAP-GRANTS-SCHEMES-05: result of loading the scheme list, carrying how many
 * rows the mapper had to drop (missing id/code/name) so the page can show an
 * honest "N hidden" warning instead of silently shrinking the list.
 */
export type GrantSchemesLoad = LoaderResult<GrantSchemeSummary[]> & { droppedCount: number };

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
  /**
   * GAP-GRANTS-APPLICATIONS-01: application-stage status from the real
   * /v1/grants/applications projection (draft→withdrawn), not the collapsed
   * sanctioned-grant status. "active"/"completed"/"suspended"/"cancelled" are
   * retained for backward compatibility with any sanctioned-grant row.
   */
  status:
    | "draft"
    | "submitted"
    | "under_review"
    | "approved"
    | "rejected"
    | "withdrawn"
    | "active"
    | "completed"
    | "suspended"
    | "cancelled";
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

/**
 * GAP-GRANTS-SCHEMES-04: like toNumber, but returns null (not a fabricated 0)
 * when the value is absent or not a finite number — so a scheme with no
 * application count renders "—" rather than "0".
 */
function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mappers
// ──────────────────────────────────────────────────────────────────────────────

const SCHEME_STATUSES = ["draft", "open", "closed", "completed", "cancelled"] as const;

/**
 * Parse the raw schemes payload into typed rows, counting how many rows had to
 * be dropped (missing id/code/name). Separated from the fetchJson mapper so
 * getGrantSchemes can surface the dropped count to the page (GAP-GRANTS-SCHEMES-05).
 * Returns null when the payload is not list-shaped at all.
 */
function parseSchemeSummaries(payload: unknown): { rows: GrantSchemeSummary[]; dropped: number } | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const out: GrantSchemeSummary[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (!isRecord(row)) {
      dropped += 1;
      continue;
    }
    const id = toText(row.id);
    const code = toText(row.code);
    const name = toText(row.name);
    if (!id || !code || !name) {
      dropped += 1;
      continue;
    }

    const rawStatus = toText(row.status) ?? "draft";
    // GAP-GRANTS-SCHEMES-05: keep an unexpected status visible as "unknown"
    // instead of silently relabelling it "draft".
    const safeStatus: GrantSchemeSummary["status"] = SCHEME_STATUSES.includes(
      rawStatus as (typeof SCHEME_STATUSES)[number],
    )
      ? (rawStatus as GrantSchemeSummary["status"])
      : "unknown";

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
      // GAP-GRANTS-SCHEMES-04: null when the API returned no count; no
      // projectCount fallback (its meaning is not defined as "applications").
      applicationCount: toNumberOrNull(row.applicationCount ?? row.application_count),
    });
  }
  return { rows: out, dropped };
}

const DROPPED_COUNT = Symbol("grantSchemesDropped");

function mapGrantSchemeSummaries(payload: unknown): GrantSchemeSummary[] | null {
  const parsed = parseSchemeSummaries(payload);
  if (!parsed) return null;
  // GAP-GRANTS-SCHEMES-05: if rows were received but EVERY one was invalid,
  // treat it as an error (source "error") rather than an empty list, so the UI
  // shows the error state, not the first-run "No schemes yet" empty state.
  if (parsed.rows.length === 0 && parsed.dropped > 0) return null;
  // Carry the dropped count on the array (non-enumerable) so getGrantSchemes
  // can surface it without changing fetchJson's generic shape.
  Object.defineProperty(parsed.rows, DROPPED_COUNT, {
    value: parsed.dropped,
    enumerable: false,
  });
  return parsed.rows;
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

    const rawStatus = toText(row.status) ?? "submitted";
    const validStatuses = [
      "draft", "submitted", "under_review", "approved", "rejected", "withdrawn",
      "active", "completed", "suspended", "cancelled",
    ] as const;
    const safeStatus = validStatuses.includes(rawStatus as typeof validStatuses[number])
      ? (rawStatus as GrantApplicationSummary["status"])
      : "submitted";

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

export async function getGrantSchemes(): Promise<GrantSchemesLoad> {
  const result = await fetchJson<unknown, GrantSchemeSummary[]>("/api/v1/grants/schemes", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.schemes",
    mapResponse: mapGrantSchemeSummaries,
  });
  // GAP-GRANTS-SCHEMES-05: recompute the dropped count from the same source so
  // the page can warn when rows were hidden. On the error path there is no
  // payload to parse, so dropped is 0.
  const droppedCount =
    (result.data as unknown as Record<symbol, number>)[DROPPED_COUNT] ?? 0;
  return { ...result, droppedCount };
}

export async function getGrantApplications(): Promise<LoaderResult<GrantApplicationSummary[]>> {
  // GAP-GRANTS-APPLICATIONS-01 / HOME-02: the real applications surface — this
  // endpoint returns application-stage statuses (submitted/under_review/...),
  // keyed by the SAME id the /grants/applications/[id] detail route reads, so
  // a row never 404s. (Previously this pointed at /grants/grants, the
  // sanctioned-grants list, which only ever showed approved+ records.)
  return fetchJson<unknown, GrantApplicationSummary[]>("/api/v1/grants/applications", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.applications",
    mapResponse: mapGrantApplicationSummaries,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Additional types added for detail pages
// ──────────────────────────────────────────────────────────────────────────────

export type GrantApplicationDetail = {
  id: string;
  grantNo: string | null;
  schemeId: string;
  beneficiaryId: string;
  status: string;
  purpose: string;
  amountRequestedMinor: number;
  amountApprovedMinor: number | null;
  submittedBy: string | null;
  approvedBy: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  // GAP-GRANTS-APPLICATIONS-DETAIL-05: evaluation (latest score), when present.
  reviewerRef?: string | null;
  technicalScore?: number | null;
  financialScore?: number | null;
  totalScore?: number | null;
  recommendation?: string | null;
};

export type GrantSchemeDetail = {
  id: string;
  code: string;
  name: string;
  budgetMinor: number;
  disbursedMinor: number;
  minAmountMinor: number;
  maxAmountMinor: number;
  currency: string;
  status: string;
  openAt?: string | null;
  closeAt?: string | null;
  reportingFrequencyDays?: number | null;
  sanctionRef?: string | null;
  tenantId?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Additional mappers
// ──────────────────────────────────────────────────────────────────────────────

function mapApplicationDetail(payload: unknown): GrantApplicationDetail | null {
  if (!isRecord(payload)) return null;
  const id = toText(payload.id);
  if (!id) return null;
  return {
    id,
    grantNo: toText(payload.grantNo ?? payload.grant_no),
    schemeId: toText(payload.schemeId ?? payload.scheme_id) ?? "",
    beneficiaryId: toText(payload.beneficiaryId ?? payload.beneficiary_id) ?? "",
    status: toText(payload.status) ?? "draft",
    purpose: toText(payload.purpose) ?? "",
    amountRequestedMinor: toNumber(payload.amountRequestedMinor ?? payload.amount_requested_minor),
    amountApprovedMinor: payload.amountApprovedMinor != null ? toNumber(payload.amountApprovedMinor) : null,
    submittedBy: toText(payload.submittedBy ?? payload.submitted_by),
    approvedBy: toText(payload.approvedBy ?? payload.approved_by),
    submittedAt: toText(payload.submittedAt ?? payload.submitted_at),
    approvedAt: toText(payload.approvedAt ?? payload.approved_at),
    createdAt: toText(payload.createdAt ?? payload.created_at) ?? new Date().toISOString(),
    reviewerRef: toText(payload.scoredReviewerRef ?? payload.reviewerRef ?? payload.reviewer_ref),
    technicalScore: payload.technicalScore != null ? toNumber(payload.technicalScore) : null,
    financialScore: payload.financialScore != null ? toNumber(payload.financialScore) : null,
    totalScore: payload.totalScore != null ? toNumber(payload.totalScore) : null,
    recommendation: toText(payload.recommendation),
  };
}

function mapSchemeDetail(payload: unknown): GrantSchemeDetail | null {
  if (!isRecord(payload)) return null;
  const id = toText(payload.id);
  const code = toText(payload.code);
  const name = toText(payload.name);
  if (!id || !code || !name) return null;
  return {
    id, code, name,
    budgetMinor: toNumber(payload.budgetMinor ?? payload.budget_minor),
    disbursedMinor: toNumber(payload.disbursedMinor ?? payload.disbursed_minor),
    minAmountMinor: toNumber(payload.minAmountMinor ?? payload.min_amount_minor),
    maxAmountMinor: toNumber(payload.maxAmountMinor ?? payload.max_amount_minor),
    currency: toText(payload.currency) ?? "INR",
    status: toText(payload.status) ?? "draft",
    openAt: toText(payload.openAt ?? payload.open_at),
    closeAt: toText(payload.closeAt ?? payload.close_at),
    reportingFrequencyDays: payload.reportingFrequencyDays != null ? toNumber(payload.reportingFrequencyDays) : null,
    sanctionRef: toText(payload.sanctionRef ?? payload.sanction_ref),
    tenantId: toText(payload.tenantId ?? payload.tenant_id) ?? undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Additional loaders
// ──────────────────────────────────────────────────────────────────────────────

/** Fetch a single application by its UUID (raw ApplicationRow from the service). */
export async function getApplicationById(id: string): Promise<LoaderResult<GrantApplicationDetail | null>> {
  return fetchJson<unknown, GrantApplicationDetail | null>(
    `/api/v1/grants/applications/${id}`,
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "grants.application.detail",
      mapResponse: mapApplicationDetail,
    }
  );
}

/** Fetch a single scheme by its UUID. */
export async function getSchemeById(id: string): Promise<LoaderResult<GrantSchemeDetail | null>> {
  return fetchJson<unknown, GrantSchemeDetail | null>(
    `/api/v1/grants/schemes/${id}`,
    null,
    {
      revalidateSeconds: 60,
      telemetryKey: "grants.scheme.detail",
      mapResponse: mapSchemeDetail,
    }
  );
}
