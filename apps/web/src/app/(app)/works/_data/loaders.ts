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

function mapBillRow(r: Row): Row {
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
export function getBills(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/billing/bills?pageSize=100", [], {
    telemetryKey: "works.billing",
    mapResponse: (p) => pickItems(p).map(mapBillRow),
  });
}

// ─── Tenders ─────────────────────────────────────────────────────────────────

function mapTenderRow(r: Row): Row {
  const openingDate = strOrNull(r.openingDate);
  const isPast = !!openingDate && new Date(openingDate).getTime() < Date.now();
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
export function getTenders(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/tenders?pageSize=100", [], {
    telemetryKey: "works.tenders",
    mapResponse: (p) => pickItems(p).map(mapTenderRow),
  });
}

// ─── Approvals (AA / TS) ─────────────────────────────────────────────────────

function mapAaRow(r: Row): Row {
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

function mapTsRow(r: Row): Row {
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
export function getApprovalsAa(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/approvals/aa?pageSize=100", [], {
    telemetryKey: "works.approvals.aa",
    mapResponse: (p) => pickItems(p).map(mapAaRow),
  });
}

/** Tenant-wide TS register — backs the /works/approvals list page. */
export function getApprovalsTs(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/approvals/ts?pageSize=100", [], {
    telemetryKey: "works.approvals.ts",
    mapResponse: (p) => pickItems(p).map(mapTsRow),
  });
}

// ─── Execution (progress + issues) ──────────────────────────────────────────

function mapProgressRow(r: Row): Row {
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

function mapIssueRow(r: Row): Row {
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
export function getExecutionProgress(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/execution/progress?pageSize=100", [], {
    telemetryKey: "works.execution.progress",
    mapResponse: (p) => pickItems(p).map(mapProgressRow),
  });
}

/** Tenant-wide issues register — backs the /works/execution issues tab. */
export function getExecutionIssues(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/execution/issues?pageSize=100", [], {
    telemetryKey: "works.execution.issues",
    mapResponse: (p) => pickItems(p).map(mapIssueRow),
  });
}

// ─── Closure ─────────────────────────────────────────────────────────────────

function mapClosureRow(r: Row): Row {
  return {
    id: str(r.id),
    workNumber: str(r.workNumber) || shortId(strOrNull(r.workId)),
    description: str(r.description, "—"),
    agreement: str(r.agreementNumber, "—"),
    statusDate: fmtDate(strOrNull(r.closedDate)),
    remarks: str(r.remarks, "—"),
    status: str(r.closureType, "closed"),
  };
}

/** Tenant-wide closure register — backs the /works/closure list page. */
export function getClosures(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/closure?pageSize=100", [], {
    telemetryKey: "works.closure",
    mapResponse: (p) => pickItems(p).map(mapClosureRow),
  });
}

// ─── BoQ ─────────────────────────────────────────────────────────────────────

function mapBoqRow(r: Row): Row {
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
export function getBoqItems(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/boq?pageSize=100", [], {
    telemetryKey: "works.boq",
    mapResponse: (p) => pickItems(p).map(mapBoqRow),
  });
}

// ─── Proposals ──────────────────────────────────────────────────────────────────────

function mapProposalRow(r: Row): Row {
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
export function getProposals(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/works/proposals?pageSize=100", [], {
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
