import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";

/**
 * OutsourcedPage — outsourced staff per agency, service category, deployment location.
 * GFR 2017 Chapter 8: outsourced service contract management.
 */

type ApiEmployee = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  agency?: string;
  department?: string;
  service?: string;
  serviceCategory?: string;
  deploymentLocation?: string;
  location?: string;
  headcount?: number | string;
  contractValue?: string;
  contractEnd?: string;
  employmentType?: string;
  type?: string;
  status: string;
};

type Row = {
  id: string;
  vendor: string;
  department: string;
  service: string;
  deploymentLocation: string;
  headcount: string;
  contractEnd: string;
  status: string;
} & Record<string, unknown>;

function mapOutsourced(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => {
      const t = (e.employmentType ?? e.type ?? "").toLowerCase();
      return t === "outsourced" || t === "vendor" || t === "third_party";
    })
    .map((e) => ({
      id: e.id,
      vendor: e.agency ?? "—",
      department: e.department ?? "—",
      service: e.service ?? e.serviceCategory ?? "—",
      deploymentLocation: e.deploymentLocation ?? e.location ?? "—",
      headcount: String(e.headcount ?? "1"),
      contractEnd: e.contractEnd ?? "—",
      status: e.status,
    }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.workforce.outsourced",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapOutsourced(arr as ApiEmployee[]) : null;
    },
  });
}

export default async function OutsourcedPage() {
  const t = await getTranslations("workforceOutsourced");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const vendors = new Set(items.map((i) => i.vendor).filter((v) => v !== "—")).size;
  const active = items.filter((i) => i.status?.toLowerCase() === "active").length;
  const totalHeadcount = items.reduce((s, i) => s + (Number(i.headcount) || 0), 0);

  const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "vendor", label: t("colVendorAgency") },
    { key: "department", label: t("colDepartment") },
    { key: "service", label: t("colServiceCategory") },
    { key: "deploymentLocation", label: t("colLocation") },
    { key: "headcount", label: t("colHeadcount"), align: "right" },
    { key: "contractEnd", label: t("colContractEnd") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/workforce" backLabel="Back to Workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏭" iconBg="#e6f0ff" label={t("statVendors")} value={errored ? null : vendors} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statActiveContracts")} value={errored ? null : active} />
        <StatCard icon="👷" iconBg="#fffbe6" label={t("statTotalHeadcount")} value={errored ? null : totalHeadcount} />
        <StatCard icon="📋" iconBg="#f5f5f5" label={t("statTotalRecords")} value={errored ? null : items.length} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "outsourced" })} backHref="/hr/workforce" />
          </div>
        ) : (
          <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏢"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
