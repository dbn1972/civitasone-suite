import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateDdoForm } from "./CreateDdoForm";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type DdoRow = {
  ddoCode: string;
  name: string;
  departmentIds: string[];
} & Record<string, unknown>;

async function getDdos(): Promise<LoaderResult<DdoRow[]>> {
  return fetchJson<unknown, DdoRow[]>("/api/v1/payroll/ddos", [], {
    telemetryKey: "payroll.ddos",
    mapResponse: (p) => (Array.isArray(p) ? (p as DdoRow[]) : null),
  });
}

export default async function DdosPage() {
  const t = await getTranslations("payrollDdos");
  const { data: ddos, source } = await getDdos();
  const errored = source === "error";

  const rows = ddos.map((d) => ({ ...d, departmentCount: d.departmentIds?.length ?? 0 }));
  const multiDeptDdos = ddos.filter((d) => (d.departmentIds?.length ?? 0) > 1).length;
  const totalDeptMappings = ddos.reduce((s, d) => s + (d.departmentIds?.length ?? 0), 0);
  const avgDepts = ddos.length > 0 ? (totalDeptMappings / ddos.length).toFixed(1) : "0";

  const columns: { key: (keyof DdoRow & string) | "departmentCount"; label: string; align?: "left" | "right" }[] = [
    { key: "ddoCode", label: t("colDdoCode") },
    { key: "name", label: t("colName") },
    { key: "departmentCount", label: t("colDepartments"), align: "right" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : ddos.length} />
        <StatCard icon="🏢" iconBg="var(--goodbg)" label={t("statMultiDept")} value={errored ? null : multiDeptDdos} />
        <StatCard icon="🔗" iconBg="var(--warnbg)" label={t("statDeptMappings")} value={errored ? null : totalDeptMappings} />
        <StatCard icon="📊" iconBg="var(--goodbg)" label={t("statAvgDepts")} value={errored ? null : avgDepts} />
      </StatGrid>

      <CreateDdoForm />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "ddos" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<DdoRow & { departmentCount: number }>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
