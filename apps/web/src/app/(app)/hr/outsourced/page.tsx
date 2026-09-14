import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  vendor: string;
  department: string;
  headcount: string;
  service: string;
  contractValue: string;
  contractEnd: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=50", [], {
    telemetryKey: "hr.employees_limit_50",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function OutsourcedPage() {
  const t = await getTranslations("outsourced");
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "vendor", label: t("colVendor") },
    { key: "department", label: t("colDepartment") },
    { key: "headcount", label: t("colHeadcount"), align: "right" },
    { key: "service", label: t("colService") },
    { key: "contractValue", label: t("colContractValue") },
    { key: "contractEnd", label: t("colContractEnd") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const uniqueVendors = new Set(items.map((i) => i.vendor).filter(Boolean)).size;
  const activeContracts = items.filter((i) => String(i.status).toLowerCase() === "active").length;
  const totalHeadcount = items.reduce((s, i) => s + Number(i.headcount || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label={t("statTotalRecordsLabel")} value={items.length} />
        <StatCard icon="🏭" iconBg="#f0fff4" label={t("statUniqueVendorsLabel")} value={uniqueVendors} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statActiveContractsLabel")} value={activeContracts} />
        <StatCard icon="👷" iconBg="#fff7e6" label={t("statTotalHeadcountLabel")} value={totalHeadcount} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏢"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}
