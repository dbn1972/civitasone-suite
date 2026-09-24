import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";

/**
 * ContractualPage — contract employees table with renewal tracking.
 * GFR 2017 Chapter 8: contractor management compliance.
 */

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
      status: e.status ?? "—",
    }));
}

async function getContractual(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.workforce.contractual",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapContractual(arr as ApiEmployee[]) : null;
    },
  });
}

export default async function ContractualPage() {
  const t = await getTranslations("workforceContractual");
  const { data: items, source } = await getContractual();
  const errored = source === "error";

  const active = items.filter((i) => i.status === "active").length;
  const expiring = items.filter((i) => {
    const parts = i.contractTo.split("/");
    if (parts.length === 3) {
      const [dd, mm, yyyy] = parts;
      const end = new Date(`${yyyy}-${mm}-${dd}`);
      const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 30;
    }
    return false;
  }).length;
  const agencies = new Set(items.map((i) => i.agency).filter((a) => a !== "—")).size;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalContractual")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActive")} value={errored ? null : active} />
        <StatCard icon="⚠️" iconBg="var(--warnbg, #fffbe6)" label={t("statExpiring30d")} value={errored ? null : expiring} />
        <StatCard icon="🏢" iconBg="var(--bg, #f5f5f5)" label={t("statAgencies")} value={errored ? null : agencies} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "contractual" })} backHref="/hr/workforce" />
          </div>
        ) : (
          <DataTable<Row>
          columns={[
            { key: "name", label: t("colName") },
            { key: "agency", label: t("colAgency") },
            { key: "department", label: t("colDepartment") },
            { key: "designation", label: t("colDesignation") },
            { key: "contractFrom", label: t("colFrom"), sortable: false },
            { key: "contractTo", label: t("colTo"), sortable: false },
            { key: "status", label: t("colStatus"), cellType: "status" },
          ]}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
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
