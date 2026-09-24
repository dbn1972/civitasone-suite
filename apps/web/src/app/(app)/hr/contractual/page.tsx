import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type ApiEmployee = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  agency?: string;
  designation?: string;
  contractFrom?: string;
  contractTo?: string;
  employmentType?: string;
  type?: string;
  status: string;
};

type Row = {
  id: string;
  name: string;
  department: string;
  agency: string;
  designation: string;
  contractFrom: string;
  contractTo: string;
  status: string;
} & Record<string, unknown>;

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function mapContractual(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => {
      const t = (e.employmentType ?? e.type ?? "").toLowerCase();
      return t === "contract" || t === "contractual";
    })
    .map((e) => ({
      id: e.id,
      name: e.name ?? ([e.firstName, e.lastName].filter(Boolean).join(" ") || e.id),
      department: e.department ?? "—",
      agency: e.agency ?? "—",
      designation: e.designation ?? "—",
      contractFrom: formatDate(e.contractFrom),
      contractTo: formatDate(e.contractTo),
      status: e.status,
    }));
}

async function getContractual(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=50", [], {
    telemetryKey: "hr.contractual",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapContractual(arr as ApiEmployee[]) : null;
    },
  });
  return res;
}

export default async function ContractualPage() {
  const t = await getTranslations("contractual");
  const { data: items, source } = await getContractual();

  const errored = source === "error";
  const isTruncated = !errored && items.length >= 50;
  const active = items.filter((i) => i.status === "active").length;
  const completed = items.filter((i) => i.status === "completed" || i.status === "expired").length;
  const agencies = new Set(items.map((i) => i.agency).filter((a) => a !== "—")).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: t("colName") },
    { key: "department", label: t("colDepartment") },
    { key: "agency", label: t("colAgency") },
    { key: "designation", label: t("colDesignation") },
    { key: "contractFrom", label: t("colFrom") },
    { key: "contractTo", label: t("colTo") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} />
      {isTruncated && (
        <span
          role="status"
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          style={{ marginBottom: 12 }}
        >
          Showing the first {items.length} contractual employees — more may exist. Search and filters below only cover this loaded set.
        </span>
      )}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={errored ? "—" : active} />
        <StatCard icon="📁" iconBg="var(--warnbg, #fffbe6)" label={t("statExpiredLabel")} value={errored ? "—" : completed} />
        <StatCard icon="🏢" iconBg="var(--bg, #f5f5f5)" label={t("statAgenciesLabel")} value={errored ? "—" : agencies} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "contractual employees" })} backHref="/hr" />
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
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
