/**
 * works feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts): every loader
 * returns LoaderResult<T> = { data, source } and never throws. On any failure
 * (no base URL, 401, network, bad shape) it returns empty data with
 * source:"error" so pages degrade gracefully via <DataSourceBadge/>.
 *
 * Gateway routing: paths are prefixed "/api/v1/works/..." — the gateway
 * (services/gateway-service/src/registry.ts) rewrites the "/api/v1/works"
 * prefix to the service's internal base "/v1/works". Every loader here maps
 * the raw works-service row shape directly onto the display-ready keys each
 * *Table component's columns expect (e.g. billNumber → billNo, amounts stay
 * as minor-unit strings for formatMoney()).
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { billBucket, fmtDate, humanize, shortId } from "./format";
import type { WorksStatusCount, WorksSummary } from "./types";

/** Raw input row shape — genuinely unknown until validated, so this stays untyped. */
type Row = Record<string, unknown>;

function pickItems(payload: unknown): Row[] {
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data: unknown }).data;
    return Array.isArray(data) ? (data as Row[]) : [];
  }
  return Array.isArray(payload) ? (payload as Row[]) : [];
}

function asObj(x: unknown): Row {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Row) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// ─── Billing ─────────────────────────────────────────────────────────────────

/**
 * Display-ready shape mapBillRow() produces for BillingTable — NOT the raw
 * bills row (see types.ts Bill). Extends Record<string, unknown> so it
 * satisfies BillingTable's existing `bills: Record<string, unknown>[]` prop
 * without having to widen that component's typing too.
 */
export interface BillRow extends Record<string, unknown> {
  id: string;
  workId: string;
  billNo: string;
  work: string;
  mode: string;
  gross: string;
  netPayable: string;
  stage: string;
  status: "draft" | "pending" | "finalized" | "submitted_ifms";
}

function mapBillRow(r: Row): BillRow {
  const status = str(r.status, "draft");
  return {
    id: str(r.id),
    workId: str(r.workId),
    billNo: str(r.billNumber),
    work: shortId(strOrNull(r.workId)),
    mode: humanize(str(r.billMode)),
    gross: str(r.grossAmountMinor, "0"),
    netPayable: str(r.netPayableMinor, "0"),
    stage: humanize(status),
    status: billBucket(status),
  };
}

/** Tenant-wide bills register — backs the /works/billing list page. */
export function getBills(): Promise<LoaderResult<BillRow[]>> {
  return fetchJson<unknown, BillRow[]>("/api/v1/works/billing/bills?pageSize=100", [], {
    telemetryKey: "works.billing",
    mapResponse: (p) => pickItems(p).map(mapBillRow),
  });
}

// ─── Tenders ─────────────────────────────────────────────────────────────────

/**
 * Display-ready shape mapTenderRow() produces for TendersTable.
 *
 * NOTE (verified against services/works-service/src/modules/tender/repo.ts
 * listTenders()): the tenders list response has NO status field at all —
 * `tenders` carries no status column (only `pre_tenders.status` does, and
 * that table isn't joined here). So `status` below is always derived from
 * the openingDate-vs-now heuristic, never from a backend value.
 */
export interface TenderRow extends Record<string, unknown> {
  id: string;
  work: string;
  tenderType: string;
  amount: string;
  openingDate: string;
  authority: string;
  status: string;
}

function mapTenderRow(r: Row): TenderRow {
  const openingDate = strOrNull(r.openingDate);
  const isPast = !!openingDate && new Date(openingDate).getTime() < Date.now();
  // preTenderStatus/status: neither is ever present on this endpoint's rows
  // (see listTenders() — no status column selected or joinable). Kept as a
  // defensive read in case the backend adds one later; today this is always
  // null and `status` below always falls through to the isPast heuristic.
  const dbStatus = strOrNull(r.preTenderStatus) ?? strOrNull(r.status);
  return {
    id: str(r.id),
    work: str(r.workNumber) || shortId(strOrNull(r.workId)),
    tenderType: shortId(strOrNull(r.tenderTypeId)),
    amount: str(r.tenderAmountMinor, "0"),
    openingDate: fmtDate(openingDate),
    authority: shortId(strOrNull(r.approvingAuthorityId)),
    status: dbStatus ?? (isPast ? "closed" : "open"),
  };
}

/** Tenant-wide tender register — backs the /works/tenders list page. */
export function getTenders(): Promise<LoaderResult<TenderRow[]>> {
  return fetchJson<unknown, TenderRow[]>("/api/v1/works/tenders?pageSize=100", [], {
    telemetryKey: "works.tenders",
    mapResponse: (p) => pickItems(p).map(mapTenderRow),
  });
}

// ─── Approvals (AA / TS) ─────────────────────────────────────────────────────

/** Display-ready shape mapAaRow() produces for ApprovalsTable (AA tab). */
export interface AaRow extends Record<string, unknown> {
  id: string;
  workNumber: string;
  approvalNumber: string;
  date: string;
  authority: string;
  amount: string;
  type: string;
  status: string;
}

/** Display-ready shape mapTsRow() produces for ApprovalsTable (TS tab). */
export interface TsRow extends Record<string, unknown> {
  id: string;
  workNumber: string;
  approvalNumber: string;
  date: string;
  authority: string;
  amount: string;
  type: string;
  status: string;
}

function mapAaRow(r: Row): AaRow {
  return {
    id: str(r.id),
    workNumber: shortId(strOrNull(r.workId)),
    approvalNumber: str(r.aaNumber),
    date: fmtDate(strOrNull(r.aaDate)),
    authority: shortId(strOrNull(r.approvingAuthorityId)),
    amount: str(r.approvedAmountMinor, "0"),
    type: humanize(str(r.approvalType, "original")),
    status: str(r.status, "draft"),
  };
}

function mapTsRow(r: Row): TsRow {
  return {
    id: str(r.id),
    workNumber: shortId(strOrNull(r.workId)),
    approvalNumber: str(r.tsNumber),
    date: fmtDate(strOrNull(r.tsDate)),
    authority: shortId(strOrNull(r.tsAuthorityId)),
    amount: str(r.tsAmountMinor, "0"),
    type: humanize(str(r.sanctionType, "original")),
    status: str(r.status, "draft"),
  };
}

/** Tenant-wide AA register — backs the /works/approvals list page. */
export function getApprovalsAa(): Promise<LoaderResult<AaRow[]>> {
  return fetchJson<unknown, AaRow[]>("/api/v1/works/approvals/aa?pageSize=100", [], {
    telemetryKey: "works.approvals.aa",
    mapResponse: (p) => pickItems(p).map(mapAaRow),
  });
}

/** Tenant-wide TS register — backs the /works/approvals list page. */
export function getApprovalsTs(): Promise<LoaderResult<TsRow[]>> {
  return fetchJson<unknown, TsRow[]>("/api/v1/works/approvals/ts?pageSize=100", [], {
    telemetryKey: "works.approvals.ts",
    mapResponse: (p) => pickItems(p).map(mapTsRow),
  });
}

// ─── Execution (progress + issues) ──────────────────────────────────────────

/** Display-ready shape mapProgressRow() produces for ExecutionTable (progress tab). */
export interface ProgressRow extends Record<string, unknown> {
  id: string;
  workId: string;
  work: string;
  scope: string;
  target: string;
  achievement: string;
  percentage: number;
}

/** Display-ready shape mapIssueRow() produces for ExecutionTable (issues tab). */
export interface IssueRow extends Record<string, unknown> {
  id: string;
  workId: string;
  work: string;
  description: string;
  raisedDate: string;
  status: string;
}

function mapProgressRow(r: Row): ProgressRow {
  return {
    id: str(r.id),
    workId: str(r.workId),
    work: shortId(strOrNull(r.workId)),
    scope: shortId(strOrNull(r.scopeId)),
    target: str(r.targetValue, "—"),
    achievement: str(r.currentAchievement, "0"),
    percentage: num(r.percentage, 0),
  };
}

function mapIssueRow(r: Row): IssueRow {
  return {
    id: str(r.id),
    workId: str(r.workId),
    work: shortId(strOrNull(r.workId)),
    description: str(r.description),
    raisedDate: fmtDate(strOrNull(r.raisedDate)),
    status: str(r.status, "open"),
  };
}

/** Tenant-wide scope-progress register — backs the /works/execution list page. */
export function getExecutionProgress(): Promise<LoaderResult<ProgressRow[]>> {
  return fetchJson<unknown, ProgressRow[]>("/api/v1/works/execution/progress?pageSize=100", [], {
    telemetryKey: "works.execution.progress",
    mapResponse: (p) => pickItems(p).map(mapProgressRow),
  });
}

/** Tenant-wide issues register — backs the /works/execution issues tab. */
export function getExecutionIssues(): Promise<LoaderResult<IssueRow[]>> {
  return fetchJson<unknown, IssueRow[]>("/api/v1/works/execution/issues?pageSize=100", [], {
    telemetryKey: "works.execution.issues",
    mapResponse: (p) => pickItems(p).map(mapIssueRow),
  });
}

// ─── Closure ─────────────────────────────────────────────────────────────────

/**
 * Display-ready shape mapClosureRow() produces for ClosureTable.
 *
 * No `agreement` field: work_closures has no agreement-number column, and
 * listClosures() (services/works-service/src/modules/execution/repo.ts)
 * doesn't join `awards` (the only table with `agreementNumber`) the way it
 * joins `work_proposals` for workNumber/description. This was originally
 * typed with an `agreement` field that always rendered the "—" fallback;
 * the works-deep-verify pass (see mapClosureRow below and ClosureTable.tsx)
 * dropped the dead field and column outright rather than leave a
 * permanently-empty one. Would need a backend join to populate for real.
 */
export interface ClosureRow extends Record<string, unknown> {
  id: string;
  workNumber: string;
  description: string;
  statusDate: string;
  remarks: string;
  status: string;
}

function mapClosureRow(r: Row): ClosureRow {
  return {
    id: str(r.id),
    workNumber: str(r.workNumber) || shortId(strOrNull(r.workId)),
    description: str(r.description, "—"),
    // Bug fix (works-deep-verify): dropped `agreement: r.agreementNumber` —
    // listClosures (execution/repo.ts) never returns an agreementNumber
    // field (that column only exists on the unrelated `awards` table), so
    // this always rendered the "—" fallback. See ClosureTable.tsx for the
    // full explanation and the join-based alternative fix.
    statusDate: fmtDate(strOrNull(r.closedDate)),
    remarks: str(r.remarks, "—"),
    status: str(r.closureType, "closed"),
  };
}

/** Tenant-wide closure register — backs the /works/closure list page. */
export function getClosures(): Promise<LoaderResult<ClosureRow[]>> {
  return fetchJson<unknown, ClosureRow[]>("/api/v1/works/closure?pageSize=100", [], {
    telemetryKey: "works.closure",
    mapResponse: (p) => pickItems(p).map(mapClosureRow),
  });
}

// ─── BoQ ─────────────────────────────────────────────────────────────────────

/** Display-ready shape mapBoqRow() produces for BoqTable. */
export interface BoqRow extends Record<string, unknown> {
  id: string;
  workId: string;
  itemCode: string;
  description: string;
  unit: string;
  rate: string;
  quantity: string;
  amount: string;
  scope: string;
}

function mapBoqRow(r: Row): BoqRow {
  return {
    id: str(r.id),
    workId: str(r.workId),
    itemCode: str(r.itemCode, "—"),
    description: str(r.itemDescription),
    unit: str(r.unit),
    rate: str(r.rate, "0"),
    quantity: str(r.quantity, "0"),
    amount: str(r.amountMinor, "0"),
    scope: shortId(strOrNull(r.scopeId)),
  };
}

/** Tenant-wide BoQ index (all works) — backs the /works/boq list page. */
export function getBoqItems(): Promise<LoaderResult<BoqRow[]>> {
  return fetchJson<unknown, BoqRow[]>("/api/v1/works/boq?pageSize=100", [], {
    telemetryKey: "works.boq",
    mapResponse: (p) => pickItems(p).map(mapBoqRow),
  });
}

// ─── Proposals ──────────────────────────────────────────────────────────────────────

/** Display-ready shape mapProposalRow() produces for ProposalsTable. */
export interface ProposalRow extends Record<string, unknown> {
  id: string;
  workNumber: string;
  description: string;
  category: string;
  type: string;
  estimatedCost: string;
  status: string;
  office: string;
}

function mapProposalRow(r: Row): ProposalRow {
  return {
    id: str(r.id),
    workNumber: str(r.workNumber),
    description: str(r.description),
    category: humanize(str(r.category, "regular")),
    type: shortId(strOrNull(r.workTypeId)),
    estimatedCost: str(r.estimatedCostMinor, "0"),
    status: str(r.status, "draft"),
    office: shortId(strOrNull(r.executingDivisionId)),
  };
}

/** Tenant-wide work-proposal register — backs the /works/proposals list page. */
export function getProposals(): Promise<LoaderResult<ProposalRow[]>> {
  return fetchJson<unknown, ProposalRow[]>("/api/v1/works/proposals?pageSize=100", [], {
    telemetryKey: "works.proposals",
    mapResponse: (p) => pickItems(p).map(mapProposalRow),
  });
}

// ─── Reporting ───────────────────────────────────────────────────────────────

/** Works summary counts (total/active/closed) — GET /v1/works/reports/summary. */
export function getWorksSummary(): Promise<LoaderResult<WorksSummary>> {
  return fetchJson<unknown, WorksSummary>("/api/v1/works/reports/summary", { totalWorks: 0, activeWorks: 0, closedWorks: 0 }, {
    telemetryKey: "works.reports.summary",
    mapResponse: (p) => {
      const o = asObj((p as { data?: unknown })?.data ?? p);
      return { totalWorks: num(o.totalWorks), activeWorks: num(o.activeWorks), closedWorks: num(o.closedWorks) };
    },
  });
}

/** Proposal counts grouped by lifecycle status — GET /v1/works/reports/status. */
export function getWorksStatus(): Promise<LoaderResult<WorksStatusCount[]>> {
  return fetchJson<unknown, WorksStatusCount[]>("/api/v1/works/reports/status", [], {
    telemetryKey: "works.reports.status",
    mapResponse: (p) => pickItems(p).map((r) => ({ status: str(r.status), count: num(r.count) })),
  });
}
