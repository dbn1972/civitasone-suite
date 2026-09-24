import { Button, PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  department_name: string | null;
  employee_count: number | string;
  total_gross_minor: number | string;
  total_deductions_minor: number | string;
  total_net_minor: number | string;
  total_pf_minor: number | string;
  total_esi_minor: number | string;
  total_tds_minor: number | string;
  total_pt_minor: number | string;
  period: string;
} & Record<string, unknown>;

async function getData(period?: string, runId?: string): Promise<LoaderResult<Row[]>> {
  const qs = new URLSearchParams();
  if (period) qs.set("period", period);
  if (runId) qs.set("runId", runId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchJson<unknown, Row[]>(`/api/v1/payroll/register${suffix}`, [], {
    telemetryKey: "payroll.register",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function PayrollRegisterPage({
  searchParams,
}: {
  searchParams?: { period?: string; runId?: string };
}) {
  const t = await getTranslations("payrollRegister");
  const period = searchParams?.period?.trim() || undefined;
  const runId = searchParams?.runId?.trim() || undefined;
  const { data: items, source } = await getData(period, runId);
  const errored = source === "error";

  const columns: {
    key: keyof Row & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
  }[] = [
    { key: "department_name", label: t("colDepartment") },
    { key: "employee_count", label: t("colEmployees"), align: "right" },
    { key: "total_gross_minor", label: t("colGross"), align: "right", cellType: "amount" },
    { key: "total_deductions_minor", label: t("colDeductions"), align: "right", cellType: "amount" },
    { key: "total_net_minor", label: t("colNet"), align: "right", cellType: "amount" },
    { key: "total_pf_minor", label: t("colPf"), align: "right", cellType: "amount" },
    { key: "total_esi_minor", label: t("colEsi"), align: "right", cellType: "amount" },
    { key: "total_tds_minor", label: t("colTds"), align: "right", cellType: "amount" },
    { key: "total_pt_minor", label: t("colPt"), align: "right", cellType: "amount" },
    { key: "period", label: t("colPeriod") },
  ];

  const totalEmployees = items.reduce((sum, r) => sum + Number(r.employee_count ?? 0), 0);
  const totalGrossMinor = items.reduce((sum, r) => sum + Number(r.total_gross_minor ?? 0), 0);
  const totalNetMinor = items.reduce((sum, r) => sum + Number(r.total_net_minor ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <Card title={t("filterCardTitle")} padding>
        <form method="get" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="reg-period" style={{ fontSize: 13, fontWeight: 600 }}>{t("labelPeriod")}</label>
            <input
              id="reg-period"
              name="period"
              defaultValue={period ?? ""}
              placeholder="2025-06"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="reg-run-id" style={{ fontSize: 13, fontWeight: 600 }}>{t("labelRunId")}</label>
            <input
              id="reg-run-id"
              name="runId"
              defaultValue={runId ?? ""}
              placeholder="Run UUID"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button type="submit" style={{ minHeight: 44 }}>{t("applyFilter")}</Button>
          </div>
        </form>
      </Card>

      <StatGrid>
        <StatCard icon="🏢" iconBg="var(--infobg)" label={t("statDepartments")} value={errored ? null : items.length} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployees")} value={errored ? null : totalEmployees} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")} value={errored ? null : formatMoney(totalGrossMinor)} />
        <StatCard icon="🧾" iconBg="var(--warnbg)" label={t("statNet")} value={errored ? null : formatMoney(totalNetMinor)} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "register" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          caption="Payroll register lines by department with gross, deductions, and net pay"
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📋"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
