import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { daysUntilIST } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { HR_STAFF_MANAGER_ROLES } from "@/lib/auth/workRoles";
import { EXPIRING_SOON_STATUS, contractDisplayStatus, isExpiringSoon } from "./contractRules";

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
  /** The status exactly as the API stored it; the stat tiles count by this, never by the display value. */
  rawStatus: string;
  /** Whole IST calendar days until the end date (negative = already ended); null when the end date is missing/unparseable. */
  daysToExpiry: number | null;
} & Record<string, unknown>;

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
 */
function mapContracts(apiItems: ApiContract[]): Row[] {
  return apiItems.map((c) => {
    // IST calendar-day arithmetic (GAP-HR-WORKFORCE-CONTRACTUAL-01) -- the old
    // `new Date(todayIST())` vs `new Date(endDate)` diff mixed a UTC-midnight
    // parse with a possibly-timestamp end date.
    const daysToExpiry = daysUntilIST(c.endDate);
    return {
      id: c.id,
      employeeId: c.employeeId,
      name: c.employeeName,
      department: c.department,
      agency: c.agencyRef ?? "—",
      designation: c.designation,
      contractFrom: c.startDate,
      contractTo: c.endDate,
      status: contractDisplayStatus(c.status, daysToExpiry),
      rawStatus: c.status,
      daysToExpiry,
    };
  });
}

async function getContractual(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/contracts?limit=100", [], {
    telemetryKey: "hr.contractual",
    mapResponse: (p) => {
      const arr = Array.isArray((p as { data?: unknown })?.data) ? (p as { data: ApiContract[] }).data : null;
      return arr ? mapContracts(arr) : null;
    },
  });
}

export default async function ContractualPage() {
  requireAnyRole(HR_STAFF_MANAGER_ROLES);
  const t = await getTranslations("contractual");
  const result = await getContractual();
  const { data: items, source } = result;

  const errored = source === "error";
  // Real contract-status-and-date-driven counts (GAP-HR-CONTRACTUAL-04)
  // instead of comparing employee-lifecycle statuses that this data never
  // carried in the first place.
  const hasEnded = (i: Row) => i.daysToExpiry !== null && i.daysToExpiry < 0;
  const active = items.filter((i) => i.rawStatus === "active" && !hasEnded(i)).length;
  // GAP-HR-WORKFORCE-CONTRACTUAL-01: "Expiring <=30d" is an end DATE test,
  // not a status test -- hrms-service flips active -> expiring at <=90 days,
  // so counting every status === "expiring" row overstated this tile, and an
  // ended contract still flagged expiring must not count at all.
  const expiringSoon = items.filter((i) => isExpiringSoon(i.rawStatus, i.daysToExpiry)).length;
  const expired = items.filter((i) => i.rawStatus === "expired" || (hasEnded(i) && i.rawStatus !== "terminated" && i.rawStatus !== "renewed")).length;
  const agencies = new Set(items.map((i) => i.agency).filter((a) => a !== "—")).size;
  const isTruncated = !errored && items.length >= 100;

  // Badge copy + tone for the two expiry states (the shared STATUS_MAP has no
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
  ];

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      {isTruncated && (
        <span
          role="status"
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          style={{ marginBottom: 12 }}
        >
          {t("truncatedNotice", { count: items.length })}
        </span>
      )}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActiveLabel")} value={errored ? "—" : active} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statExpiringLabel")} value={errored ? "—" : expiringSoon} />
        <StatCard icon="📁" iconBg="var(--badbg)" label={t("statExpiredLabel")} value={errored ? "—" : expired} />
        <StatCard icon="🏢" iconBg="var(--bg)" label={t("statAgenciesLabel")} value={errored ? "—" : agencies} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <LoadErrorState result={result} area="contractual employees" backHref="/hr" />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            // GAP-HR-CONTRACTUAL-05: rows open the contract detail page
            // (renew / terminate live there; employee profile is linked from it).
            rowLinkKey="id" rowLinkPrefix="/hr/contractual/"
            sortable filterable filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📑"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
