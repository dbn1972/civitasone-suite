import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

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
  status: string;
  daysToExpiry: number;
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
  const today = new Date().toISOString().slice(0, 10);
  return apiItems.map((c) => {
    const end = new Date(c.endDate);
    const now = new Date(today);
    const daysToExpiry = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: c.id,
      employeeId: c.employeeId,
      name: c.employeeName,
      department: c.department,
      agency: c.agencyRef ?? "—",
      designation: c.designation,
      contractFrom: c.startDate,
      contractTo: c.endDate,
      status: c.status,
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
  const t = await getTranslations("contractual");
  const result = await getContractual();
  const { data: items, source } = result;

  const errored = source === "error";
  // Real contract-status-and-date-driven counts (GAP-HR-CONTRACTUAL-04)
  // instead of comparing employee-lifecycle statuses that this data never
  // carried in the first place.
  const active = items.filter((i) => i.status === "active").length;
  const expiringSoon = items.filter((i) => i.status === "expiring" || (i.status === "active" && i.daysToExpiry <= 30 && i.daysToExpiry >= 0)).length;
  const expired = items.filter((i) => i.status === "expired" || (i.daysToExpiry < 0 && i.status !== "terminated" && i.status !== "renewed")).length;
  const agencies = new Set(items.map((i) => i.agency).filter((a) => a !== "—")).size;
  const isTruncated = !errored && items.length >= 100;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "date" }[] = [
    { key: "name", label: t("colName") },
    { key: "department", label: t("colDepartment") },
    { key: "agency", label: t("colAgency") },
    { key: "designation", label: t("colDesignation") },
    { key: "contractFrom", label: t("colFrom"), cellType: "date" },
    { key: "contractTo", label: t("colTo"), cellType: "date" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={errored ? "—" : active} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statExpiringLabel")} value={errored ? "—" : expiringSoon} />
        <StatCard icon="📁" iconBg="var(--badbg, #fee2e2)" label={t("statExpiredLabel")} value={errored ? "—" : expired} />
        <StatCard icon="🏢" iconBg="var(--bg, #f5f5f5)" label={t("statAgenciesLabel")} value={errored ? "—" : agencies} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <LoadErrorState result={result} area="contractual employees" backHref="/hr" />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            // GAP-HR-CONTRACTUAL-05 (partial): row now links to the existing
            // employee profile for navigability. A dedicated contract detail
            // page with renew/terminate actions (the fuller ask) is left as
            // a follow-up -- effort-M standalone build, tracked separately.
            rowHref={(r) => `/hr/employees/${r.employeeId}`}
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
