import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { daysUntilIST } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { HR_STAFF_MANAGER_ROLES } from "@/lib/auth/workRoles";
import { contractExpiryState, contractDisplayStatus, EXPIRING_SOON_STATUS, EXPIRING_WINDOW_DAYS } from "./contractRules";

type ApiContract = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  agencyRef: string | null;
  designation: string;
  startDate: string;
  endDate: string;
  status: string;
};

/** Full-scope register counts from the server (GET /v1/hrms/contracts?summary=true), not derived from the loaded page. */
type ContractSummary = { active: number; expiring: number; expired: number; agencies: number };

type Row = {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  agency: string;
  designation: string;
  contractFrom: string;
  contractTo: string;
  /** What the status badge shows (see contractDisplayStatus): `expiring_30d`, a swept `expired`, or the raw status. */
  status: string;
  /** Status-cell key for the Expiry column: "expired" | "today" | "d<N>" (days left) | "" when not applicable. */
  expiry: string;
  /** The status exactly as the API stored it; the loaded-rows fallback tally counts by this, never by the display value. */
  rawStatus: string;
  /** Whole IST calendar days until the end date (negative = already ended); null when the end date is missing/unparseable. */
  daysToExpiry: number | null;
} & Record<string, unknown>;

type ContractsPage = {
  rows: Row[];
  /** Total contracts in scope (all pages), from the server. */
  total: number;
  summary: ContractSummary | null;
};

/** Contracts per server page (the API caps `limit` at 200). */
const CONTRACTS_PAGE_SIZE = 50;

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * GAP-HR-CONTRACTUAL-01/02: this page used to fetch the general employees
 * list and filter client-side on `e.employmentType ?? e.type` -- neither
 * field the API ever sends (it sends `employeeType`), so the filter matched
 * nothing and the register was permanently empty; even a fixed filter would
 * still have left agency/designation/contract-dates blank, since the
 * employee list never carried them. Switching to GET /v1/hrms/contracts
 * (now enriched with employee name/department/designation/agencyRef, see
 * contracts/routes.ts) fixes both at once: every row here already IS a
 * contractual engagement by definition, so no employeeType filter is needed
 * at all, and the real contract dates/status/agency come from their actual
 * source of record instead of never-populated employee fields.
 *
 * GAP-HR-CONTRACTUAL-03/04: the register is paged server-side (soonest end
 * date first) and its stat cards come from the server's full-scope summary, so
 * "Total" is the real total and no contract past the first page is unreachable.
 */
function mapContracts(apiItems: ApiContract[]): Row[] {
  return apiItems.map((c) => {
    // IST calendar-day arithmetic (GAP-HR-WORKFORCE-CONTRACTUAL-01) -- the old
    // `new Date(todayIST())` vs `new Date(endDate)` diff mixed a UTC-midnight
    // parse with a possibly-timestamp end date.
    const daysToExpiry = daysUntilIST(c.endDate);
    const displayStatus = contractDisplayStatus(c.status, daysToExpiry);
    const state = contractExpiryState(c.status, daysToExpiry);
    let expiry = "";
    // The status pill already reads "Expired" for a swept contract; only add the Expiry-column badge when it carries
    // information the pill does not (e.g. an escalated contract past its end date), so a row never shows two "Expired".
    if (state === "expired") expiry = displayStatus === "expired" ? "" : "expired";
    else if (state !== "none" && daysToExpiry !== null) expiry = daysToExpiry === 0 ? "today" : `d${daysToExpiry}`;
    return {
      id: c.id,
      employeeId: c.employeeId,
      name: c.employeeName,
      department: c.department,
      agency: c.agencyRef ?? "—",
      designation: c.designation,
      contractFrom: c.startDate,
      contractTo: c.endDate,
      status: displayStatus,
      expiry,
      rawStatus: c.status,
      daysToExpiry,
    };
  });
}

/**
 * Register counts tallied from a complete (unpaged) list: the same classes as the server summary (hrms-service
 * summarizeContracts). "Expiring <=30d" is an end-DATE test there and here: hrms-service flips active -> expiring at
 * <=90 days, so counting every `expiring` row would overstate this tile, and an ended contract still flagged expiring
 * must not count at all.
 */
function tallyLoadedRows(rows: Row[]): ContractSummary {
  const hasEnded = (r: Row) => r.daysToExpiry !== null && r.daysToExpiry < 0;
  return {
    active: rows.filter((r) => r.rawStatus === "active" && !hasEnded(r)).length,
    // contractExpiryState is the single end-date rule (draft / terminated / renewed are in none of the classes, as in
    // summarizeContracts), so an ended `draft` contract is not counted as expired here either.
    expiring: rows.filter((r) => contractExpiryState(r.rawStatus, r.daysToExpiry) === "expiring").length,
    expired: rows.filter((r) => contractExpiryState(r.rawStatus, r.daysToExpiry) === "expired").length,
    agencies: new Set(rows.map((r) => r.agency).filter((a) => a !== "—")).size,
  };
}

async function getContractual(page: number): Promise<LoaderResult<ContractsPage>> {
  const params = new URLSearchParams({
    limit: String(CONTRACTS_PAGE_SIZE),
    offset: String((page - 1) * CONTRACTS_PAGE_SIZE),
    sort: "endDate",
    summary: "true",
  });
  return fetchJson<unknown, ContractsPage>(`/api/v1/hrms/contracts?${params.toString()}`, { rows: [], total: 0, summary: null }, {
    telemetryKey: "hr.contractual",
    mapResponse: (p) => {
      const body = p as { data?: unknown; meta?: { total?: number; summary?: ContractSummary } } | null;
      const arr = Array.isArray(body?.data) ? (body!.data as ApiContract[]) : null;
      if (!arr) return null;
      const rows = mapContracts(arr);
      // A paged response (meta.total present) must bring its own full-scope summary: a count derived from one page would
      // lie, so no summary means "—". A response with no paging meta at all is the complete, unpaged list, so the loaded
      // rows ARE the full scope and are tallied here (GAP-HR-WORKFORCE-CONTRACTUAL-01).
      const summary = body?.meta?.summary ?? (body?.meta?.total === undefined ? tallyLoadedRows(rows) : null);
      return { rows, total: body?.meta?.total ?? arr.length, summary };
    },
  });
}

export default async function ContractualPage({ searchParams }: { searchParams?: { page?: string } }) {
  requireAnyRole(HR_STAFF_MANAGER_ROLES);
  const t = await getTranslations("contractual");
  const page = parsePage(searchParams?.page);
  const result = await getContractual(page);
  const { data, source } = result;
  const { rows: items, total, summary } = data;

  const errored = source === "error";
  // GAP-HR-CONTRACTUAL-03/04: the stat cards are the server's full-scope counts (classified by contract status AND
  // end date against the IST date), not counts of whichever page loaded; "—" when the API sent no summary.
  const stat = (n: number | undefined): number | string => (errored || n === undefined ? "—" : n);

  const from = (page - 1) * CONTRACTS_PAGE_SIZE + 1;
  const to = (page - 1) * CONTRACTS_PAGE_SIZE + items.length;
  const hasMore = to < total;
  const showPager = !errored && (page > 1 || hasMore);
  const pageHref = (target: number): string => (target > 1 ? `/hr/contractual?page=${target}` : "/hr/contractual");

  // Per-row Expiry badge (GAP-HR-CONTRACTUAL-04): server-safe status-cell keys -> translated label + tone.
  const expiryLabels: Record<string, string> = { expired: t("badgeExpired"), today: t("badgeExpiresToday") };
  const expiryVariants: Record<string, "good" | "warn" | "mut" | "bad" | "info"> = { expired: "bad", today: "warn" };
  for (const r of items) {
    if (r.expiry.startsWith("d") && !(r.expiry in expiryLabels)) {
      const days = Number(r.expiry.slice(1));
      expiryLabels[r.expiry] = t("badgeExpiresIn", { days });
      expiryVariants[r.expiry] = days <= EXPIRING_WINDOW_DAYS ? "warn" : "mut";
    }
  }

  // Status badge copy + tone for the two expiry states (GAP-HR-WORKFORCE-CONTRACTUAL-01; the shared STATUS_MAP has no
  // `expiring` entry, so it used to fall through to the neutral info pill).
  const statusLabels = { expiring: t("statusExpiring"), [EXPIRING_SOON_STATUS]: t("statusExpiring30d") };
  const statusVariants = { expiring: "warn", [EXPIRING_SOON_STATUS]: "bad" } as const;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "date"; statusLabels?: Record<string, string>; statusVariants?: Record<string, "good" | "warn" | "mut" | "bad" | "info"> }[] = [
    { key: "name", label: t("colName") },
    { key: "department", label: t("colDepartment") },
    { key: "agency", label: t("colAgency") },
    { key: "designation", label: t("colDesignation") },
    { key: "contractFrom", label: t("colFrom"), cellType: "date" },
    { key: "contractTo", label: t("colTo"), cellType: "date" },
    { key: "status", label: t("colStatus"), cellType: "status", statusLabels, statusVariants },
    { key: "expiry", label: t("colExpiry"), cellType: "status", statusLabels: expiryLabels, statusVariants: expiryVariants },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backLabel")} />
      {showPager && (
        <span
          role="status"
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          style={{ marginBottom: 12 }}
        >
          {t("pageNotice", { from, to, total })}
        </span>
      )}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalLabel")} value={errored ? "—" : total} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActiveLabel")} value={stat(summary?.active)} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statExpiringLabel")} value={stat(summary?.expiring)} />
        <StatCard icon="📁" iconBg="var(--badbg)" label={t("statExpiredLabel")} value={stat(summary?.expired)} />
        <StatCard icon="🏢" iconBg="var(--bg)" label={t("statAgenciesLabel")} value={stat(summary?.agencies)} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <LoadErrorState result={result} area="contractual employees" backHref="/hr" />
        ) : (
          <>
            <DataTable<Row>
              columns={columns}
              rows={items}
              // GAP-HR-CONTRACTUAL-05: rows open the contract detail page
              // (renew / terminate live there; employee profile is linked from it).
              rowLinkKey="id" rowLinkPrefix="/hr/contractual/"
              sortable filterable filterPlaceholder={t("filterPlaceholder")}
              // One server page per table page: "page 1 shows 50", the pager below walks the rest.
              pageSize={CONTRACTS_PAGE_SIZE}
              emptyIcon="📑"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage")}
            />
            {showPager && (
              <nav aria-label={t("pagerAriaLabel")} style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px" }}>
                {page > 1 && <Link href={pageHref(page - 1)} className="btn ghost">{t("prevPageLink")}</Link>}
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("pageLabel", { page })}</span>
                {hasMore && <Link href={pageHref(page + 1)} className="btn ghost">{t("nextPageLink")}</Link>}
              </nav>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
