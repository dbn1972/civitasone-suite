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
import { formatIndianDate } from "@/lib/formatters";
import { billBucket, deriveTenderStatus, fmtDate, humanize, modeLabel, shortId } from "./format";
import type { BillStatus, WorksStatusCount, WorksSummary } from "./types";
import { normalizeClosureType } from "./types";

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
  /** Coarse bucket for the register pill. */
  status: "draft" | "pending" | "finalized" | "submitted_ifms";
  /**
   * GAP-WORKS-BILLING-WORKID-01/02: the raw bills.status workflow code
   * (draft | so_finalized | … | submitted). BillingActions needs this to
   * compute the next finalize step and to render the granular status label,
   * while the table pill uses the coarse `status` bucket above.
   */
  rawStatus: BillStatus | string;
}

function mapBillRow(r: Row): BillRow {
  const status = str(r.status, "draft");
  return {
    id: str(r.id),
    workId: str(r.workId),
    billNo: str(r.billNumber),
    // GAP-WORKS-BILLING-02: prefer a human-readable work number when the
    // endpoint joins it (as tenders/closure do); fall back to the short id.
    work: str(r.workNumber) || shortId(strOrNull(r.workId)),
    mode: modeLabel(str(r.billMode)),
    gross: str(r.grossAmountMinor, "0"),
    netPayable: str(r.netPayableMinor, "0"),
    stage: humanize(status),
    status: billBucket(status),
    rawStatus: status,
  };
}

/** Tenant-wide bills register — backs the /works/billing list page. */
export function getBills(): Promise<LoaderResult<BillRow[]>> {
  return fetchJson<unknown, BillRow[]>("/api/v1/works/billing/bills?pageSize=100", [], {
    telemetryKey: "works.billing",
    mapResponse: (p) => pickItems(p).map(mapBillRow),
  });
}

/**
 * GAP-WORKS-BILLING-WORKID-01: bills for a single work — backs the
 * /works/billing/[workId] detail page. Reuses mapBillRow() so billNumber →
 * billNo and billMode → mode (via modeLabel) exactly as the register does,
 * and carries rawStatus for BillingActions. The backend route
 * GET /v1/works/billing/:workId/bills already exists (billing/routes.ts).
 */
export function getBillsForWork(workId: string): Promise<LoaderResult<BillRow[]>> {
  return fetchJson<unknown, BillRow[]>(`/api/v1/works/billing/${workId}/bills`, [], {
    telemetryKey: "works.billing.detail",
    mapResponse: (p) => pickItems(p).map(mapBillRow),
  });
}

/**
 * GAP-WORKS-BILLING-WORKID-04: measurement books for a single work — backs the
 * MB finalize list on the detail page (replaces the paste-a-UUID input). Backs
 * onto the new GET /v1/works/billing/:workId/mbs route (billing/routes.ts).
 */
export interface MbRow extends Record<string, unknown> {
  id: string;
  mbNumber: string;
  stage: string;
  rawStatus: string;
}

function mapMbRow(r: Row): MbRow {
  const status = str(r.status, "draft");
  return {
    id: str(r.id),
    mbNumber: str(r.mbNumber),
    stage: humanize(status),
    rawStatus: status,
  };
}

export function getMbsForWork(workId: string): Promise<LoaderResult<MbRow[]>> {
  return fetchJson<unknown, MbRow[]>(`/api/v1/works/billing/${workId}/mbs`, [], {
    telemetryKey: "works.billing.mbs",
    mapResponse: (p) => pickItems(p).map(mapMbRow),
  });
}

/**
 * GAP-WORKS-BILLING-BILLS-NEW-01 / NEW-MB-01: awards for a work — backs the
 * award picker on the Generate Bill and Issue MB forms, replacing the
 * paste-a-UUID input (the Tenders list never carried an award id). Backs onto
 * the new GET /v1/works/billing/:workId/awards route.
 */
export interface AwardOption extends Record<string, unknown> {
  id: string;
  label: string;
}

function mapAwardOption(r: Row): AwardOption {
  const id = str(r.id);
  const agreement = strOrNull(r.agreementNumber);
  return { id, label: agreement ? `${agreement} (${shortId(id)})` : shortId(id) };
}

export function getAwardsForWork(workId: string): Promise<LoaderResult<AwardOption[]>> {
  return fetchJson<unknown, AwardOption[]>(`/api/v1/works/billing/${workId}/awards`, [], {
    telemetryKey: "works.billing.awards",
    mapResponse: (p) => pickItems(p).map(mapAwardOption),
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
  /** Raw ISO opening date (unformatted) for client-side range filtering (GAP-WORKS-TENDERS-04). */
  openingDateIso: string | null;
  authority: string;
  /** Raw master ids for web-side name resolution (GAP-WORKS-TENDERS-02/NEW-03). */
  tenderTypeId: string | null;
  approvingAuthorityId: string | null;
  /** Honest display label from deriveTenderStatus (GAP-WORKS-TENDERS-01). */
  status: string;
  /** Machine status key for filtering / StatusPill tone (GAP-WORKS-TENDERS-01/04). */
  statusKey: string;
}

function mapTenderRow(r: Row): TenderRow {
  const openingDate = strOrNull(r.openingDate);
  // GAP-WORKS-TENDERS-01/DETAIL-05: derive an honest schedule-fact status via
  // the shared helper rather than inventing "Open"/"Closed" the backend does
  // not own. The list has no award state (listTenders() returns none), so an
  // awarded flag is only ever available on the detail page.
  const dbStatus = strOrNull(r.preTenderStatus) ?? strOrNull(r.status);
  const view = deriveTenderStatus({ openingDate, backendStatus: dbStatus });
  // GAP-WORKS-TENDERS-02/NEW-02: a missing amount is "—", never a fabricated
  // ₹0.00; a missing type/authority is "—", never an 8-char UUID prefix. The
  // page resolves tenderTypeId/approvingAuthorityId to names via the masters
  // maps (no cross-module join — the service masters live in another module).
  const amountRaw = strOrNull(r.tenderAmountMinor);
  return {
    id: str(r.id),
    work: str(r.workNumber) || shortId(strOrNull(r.workId)),
    tenderType: str(r.tenderTypeName) || "—",
    amount: amountRaw && /^\d+$/.test(amountRaw) ? amountRaw : "",
    openingDate: fmtDate(openingDate),
    openingDateIso: openingDate,
    authority: str(r.approvingAuthorityName) || "—",
    tenderTypeId: strOrNull(r.tenderTypeId),
    approvingAuthorityId: strOrNull(r.approvingAuthorityId),
    status: view.label,
    statusKey: view.key,
  };
}

/** Tenant-wide tender register — backs the /works/tenders list page. */
export function getTenders(): Promise<LoaderResult<TenderRow[]>> {
  return fetchJson<unknown, TenderRow[]>("/api/v1/works/tenders?pageSize=100", [], {
    telemetryKey: "works.tenders",
    mapResponse: (p) => pickItems(p).map(mapTenderRow),
  });
}

/**
 * GAP-WORKS-TENDERS-02 / NEW-03: id -> name maps for the tender-type and
 * approving-authority masters, so the tenders register can show real names
 * ("Open Tender", "Executive Engineer") instead of a UUID prefix. Resolved
 * web-side (not via a service join) because the masters live in a different
 * works-service module and cross-module schema joins are forbidden
 * (CLAUDE.md L2). Mirrors getWorkTypeNameMap; degrades to {} on any failure.
 */
function masterNameMap(prefix: string, telemetryKey: string): Promise<LoaderResult<Record<string, string>>> {
  return fetchJson<unknown, Record<string, string>>(`/api/v1/works/masters/${prefix}?pageSize=200`, {}, {
    telemetryKey,
    mapResponse: (p) => {
      const map: Record<string, string> = {};
      for (const row of pickItems(p)) {
        const id = strOrNull(row.id);
        const name = strOrNull(row.name) ?? strOrNull(row.code);
        if (id && name) map[id] = name;
      }
      return map;
    },
  });
}

export function getTenderTypeNameMap(): Promise<LoaderResult<Record<string, string>>> {
  return masterNameMap("tender-types", "works.masters.tender-types.map");
}

export function getAuthorityNameMap(): Promise<LoaderResult<Record<string, string>>> {
  return masterNameMap("authorities", "works.masters.authorities.map");
}

/**
 * GAP-WORKS-TENDERS-02 / NEW-03: resolve a mapped TenderRow's raw type/authority
 * ids to names using the masters maps. Leaves the existing "—" when an id has
 * no mapping (never shows a UUID). Pure; safe to call in a Server Component.
 */
export function resolveTenderNames(
  rows: TenderRow[],
  typeMap: Record<string, string>,
  authorityMap: Record<string, string>,
): TenderRow[] {
  return rows.map((r) => ({
    ...r,
    tenderType: (r.tenderTypeId && typeMap[r.tenderTypeId]) || r.tenderType,
    authority: (r.approvingAuthorityId && authorityMap[r.approvingAuthorityId]) || r.authority,
  }));
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
    // Prefer a real work number / authority name if the list API ever supplies
    // one; today the approvals list (works-service approval/repo.ts listAa)
    // returns only the opaque ids (no cross-module join to work_proposals /
    // the authority master), so this falls back to a short id, surfaced in the
    // UI under an "(ID)" column header rather than masquerading as a number
    // (GAP-WORKS-APPROVALS-01).
    workNumber: str(r.workNumber) || shortId(strOrNull(r.workId)),
    approvalNumber: str(r.aaNumber),
    date: fmtDate(strOrNull(r.aaDate)),
    authority: str(r.authorityName) || shortId(strOrNull(r.approvingAuthorityId)),
    amount: str(r.approvedAmountMinor, "0"),
    type: humanize(str(r.approvalType, "original")),
    status: str(r.status, "draft"),
  };
}

function mapTsRow(r: Row): TsRow {
  return {
    id: str(r.id),
    workNumber: str(r.workNumber) || shortId(strOrNull(r.workId)),
    approvalNumber: str(r.tsNumber),
    date: fmtDate(strOrNull(r.tsDate)),
    authority: str(r.authorityName) || shortId(strOrNull(r.tsAuthorityId)),
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
    // GAP-WORKS-EXECUTION-01: show the human work number (now returned by the
    // progress endpoint) with a UUID-prefix fallback only when truly absent.
    work: str(r.workNumber) || shortId(strOrNull(r.workId)),
    // Scope: the work_scope description (returned by the endpoint) over a
    // scopeId prefix fallback.
    scope: str(r.description) || shortId(strOrNull(r.scopeId)),
    target: str(r.targetValue, "—"),
    achievement: str(r.currentAchievement, "0"),
    percentage: num(r.percentage, 0),
  };
}

function mapIssueRow(r: Row): IssueRow {
  return {
    id: str(r.id),
    workId: str(r.workId),
    // GAP-WORKS-EXECUTION-01: human work number with UUID-prefix fallback.
    work: str(r.workNumber) || shortId(strOrNull(r.workId)),
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

/**
 * Single-work header (GAP-WORKS-EXECUTION-WORKID-01): the work number +
 * description for the execution/billing detail page title, resolved from the
 * proposal register. Returns nulls (never a UUID prefix) when unavailable.
 */
export interface WorkHeader extends Record<string, unknown> {
  workNumber: string | null;
  description: string | null;
}

export function getWorkHeader(workId: string): Promise<LoaderResult<WorkHeader>> {
  return fetchJson<unknown, WorkHeader>(
    `/api/v1/works/proposals/${encodeURIComponent(workId)}`,
    { workNumber: null, description: null },
    {
      telemetryKey: "works.execution.workHeader",
      mapResponse: (p) => {
        const o = asObj((p as { data?: unknown })?.data ?? p);
        return { workNumber: strOrNull(o.workNumber), description: strOrNull(o.description) };
      },
    },
  );
}

/**
 * Per-work scope-progress register (GAP-WORKS-EXECUTION-WORKID-04): reuses the
 * progress endpoint's new ?workId= server-side filter (no client-side slicing
 * of a capped list) and the same row mapping as the tenant-wide register.
 */
export function getWorkProgress(workId: string): Promise<LoaderResult<ProgressRow[]>> {
  return fetchJson<unknown, ProgressRow[]>(
    `/api/v1/works/execution/progress?pageSize=100&workId=${encodeURIComponent(workId)}`,
    [],
    {
      telemetryKey: "works.execution.workProgress",
      mapResponse: (p) => pickItems(p).map(mapProgressRow),
    },
  );
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
  workId: string;
  workNumber: string;
  agreement: string;
  description: string;
  statusDate: string;
  remarks: string;
  status: string;
}

function mapClosureRow(r: Row): ClosureRow {
  return {
    id: str(r.id),
    // GAP-WORKS-CLOSURE-01: keep workId so the register's rows can link to the
    // work (previously dropped, leaving the list a dead end).
    workId: str(r.workId),
    workNumber: str(r.workNumber) || shortId(strOrNull(r.workId)),
    // GAP-WORKS-CLOSURE-02: backend now returns agreementNumber only when the
    // work has exactly one finalized award (unambiguous); "—" otherwise.
    agreement: str(r.agreementNumber, "—"),
    description: str(r.description, "—"),
    // CLOSURE-04: use the IST-correct shared formatter (format.ts fmtDate uses
    // toLocaleDateString with no timeZone, which can shift a near-midnight date
    // onto the wrong day); the column header now also names the date per tab.
    statusDate: formatIndianDate(strOrNull(r.closedDate)),
    remarks: str(r.remarks, "—"),
    // GAP-WORKS-CLOSURE-03: normalise closureType to a known tab key; any
    // unexpected server value folds to "other" so it still appears under an
    // All/Other tab and is counted, rather than vanishing from every tab.
    status: normalizeClosureType(r.closureType),
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
  work: string;
  itemCode: string;
  srItemId: string | null;
  description: string;
  unit: string;
  rate: string;
  quantity: string;
  amount: string;
  scope: string;
}

function mapBoqRow(r: Row): BoqRow {
  const workId = str(r.workId);
  return {
    id: str(r.id),
    workId,
    // GAP-WORKS-BOQ-01: show the human work number so a reader can tell which
    // work a line belongs to; fall back to a short id only when the list API
    // couldn't supply a number (left-join miss / legacy row).
    work: str(r.workNumber) || shortId(strOrNull(r.workId)),
    itemCode: str(r.itemCode, "—"),
    // GAP-WORKS-BOQ-04: keep srItemId so the list can count lines actually
    // linked to a Schedule-of-Rates item (not just rows with any itemCode).
    srItemId: strOrNull(r.srItemId),
    description: str(r.itemDescription),
    unit: str(r.unit),
    rate: str(r.rate, "0"),
    quantity: str(r.quantity, "0"),
    amount: str(r.amountMinor, "0"),
    scope: shortId(strOrNull(r.scopeId)),
  };
}

/** Full-set BoQ index totals (every line, not just the fetched page). */
export interface BoqIndexSummary {
  total: number;
  totalAmountMinor: string;
  /** How many rows the current page actually returned (for the truncation hint). */
  fetched: number;
}

/** Tenant-wide BoQ index (all works) — backs the /works/boq list page. */
export function getBoqItems(): Promise<LoaderResult<BoqRow[]>> {
  return fetchJson<unknown, BoqRow[]>("/api/v1/works/boq?pageSize=100", [], {
    telemetryKey: "works.boq",
    mapResponse: (p) => pickItems(p).map(mapBoqRow),
  });
}

/**
 * GAP-WORKS-BOQ-02: the exact full-set count + paise total from the list
 * response meta, so the stat cards reflect every line, not just the first page.
 * Falls back to the fetched page's own figures (summed with BigInt) when the
 * backend meta is missing, and reports `fetched` so the page can show a
 * "showing first N" hint when the set is truncated.
 */
export function getBoqIndexSummary(): Promise<LoaderResult<BoqIndexSummary>> {
  return fetchJson<unknown, BoqIndexSummary>(
    "/api/v1/works/boq?pageSize=100",
    { total: 0, totalAmountMinor: "0", fetched: 0 },
    {
      telemetryKey: "works.boq.summary",
      mapResponse: (p) => {
        const rows = pickItems(p);
        const meta = asObj((p as { meta?: unknown })?.meta);
        const fetched = rows.length;
        const sumFetched = rows.reduce((acc, r) => {
          try {
            return acc + BigInt(str(r.amountMinor, "0"));
          } catch {
            return acc;
          }
        }, 0n);
        const metaTotal = typeof meta.total === "number" ? meta.total : num(meta.total, NaN);
        const total = Number.isFinite(metaTotal) ? metaTotal : fetched;
        const totalAmountMinor =
          typeof meta.totalAmountMinor === "string" && /^\d+$/.test(meta.totalAmountMinor)
            ? meta.totalAmountMinor
            : sumFetched.toString();
        return { total, totalAmountMinor, fetched };
      },
    },
  );
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
    // GAP-WORKS-PROPOSALS-01: carry the raw workTypeId so the page can resolve
    // it to a readable name against the work-types master; the display `type`
    // defaults to "—" (not an unreadable 8-char id prefix) until resolved.
    workTypeId: strOrNull(r.workTypeId),
    type: "—",
    estimatedCost: str(r.estimatedCostMinor, "0"),
    status: str(r.status, "draft"),
    // GAP-WORKS-PROPOSALS-01: executing division has no NAME master in
    // works-service, so an 8-char id prefix was meaningless. Show "—" rather
    // than a fragment of a UUID; a real office lookup needs a backend master.
    office: "—",
  };
}

/** Tenant-wide work-proposal register — backs the /works/proposals list page. */
export function getProposals(): Promise<LoaderResult<ProposalRow[]>> {
  return fetchJson<unknown, ProposalRow[]>("/api/v1/works/proposals?pageSize=100", [], {
    telemetryKey: "works.proposals",
    mapResponse: (p) => pickItems(p).map(mapProposalRow),
  });
}

/**
 * GAP-WORKS-PROPOSALS-01: id -> name map for the work-types master, so the
 * proposals register can show "Road Works" instead of a UUID prefix and the
 * table filter can match on the name. Degrades gracefully to an empty map on
 * any failure (the page then shows "—" for the type, never a broken id).
 */
export function getWorkTypeNameMap(): Promise<LoaderResult<Record<string, string>>> {
  return fetchJson<unknown, Record<string, string>>("/api/v1/works/masters/work-types?pageSize=200", {}, {
    telemetryKey: "works.masters.work-types.map",
    mapResponse: (p) => {
      const map: Record<string, string> = {};
      for (const row of pickItems(p)) {
        const id = strOrNull(row.id);
        const name = strOrNull(row.name) ?? strOrNull(row.code);
        if (id && name) map[id] = name;
      }
      return map;
    },
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
