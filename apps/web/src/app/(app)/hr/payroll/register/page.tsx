import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";

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
  const period = searchParams?.period?.trim() || undefined;
  const runId = searchParams?.runId?.trim() || undefined;
  const { data: items, source } = await getData(period, runId);

  const columns: {
    key: keyof Row & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
  }[] = [
    { key: "department_name", label: "Department" },
    { key: "employee_count", label: "Employees", align: "right" },
    { key: "total_gross_minor", label: "Gross", align: "right", cellType: "amount" },
    { key: "total_deductions_minor", label: "Deductions", align: "right", cellType: "amount" },
    { key: "total_net_minor", label: "Net Pay", align: "right", cellType: "amount" },
    { key: "total_pf_minor", label: "PF", align: "right", cellType: "amount" },
    { key: "total_esi_minor", label: "ESI", align: "right", cellType: "amount" },
    { key: "total_tds_minor", label: "TDS", align: "right", cellType: "amount" },
    { key: "total_pt_minor", label: "PT", align: "right", cellType: "amount" },
    { key: "period", label: "Period" },
  ];

  const totalEmployees = items.reduce((sum, r) => sum + Number(r.employee_count ?? 0), 0);
  const totalGrossMinor = items.reduce((sum, r) => sum + Number(r.total_gross_minor ?? 0), 0);
  const totalNetMinor = items.reduce((sum, r) => sum + Number(r.total_net_minor ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Payroll Register"
        subtitle="Department-wise payroll summary for a run or period."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <Card title="Filter Register" padding>
        <form method="get" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="reg-period" style={{ fontSize: 13, fontWeight: 600 }}>Period</label>
            <input
              id="reg-period"
              name="period"
              defaultValue={period ?? ""}
              placeholder="2025-06"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="reg-run-id" style={{ fontSize: 13, fontWeight: 600 }}>Run ID</label>
            <input
              id="reg-run-id"
              name="runId"
              defaultValue={runId ?? ""}
              placeholder="Run UUID"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }}>Apply Filter</button>
          </div>
        </form>
      </Card>

      <StatGrid>
        <StatCard icon="🏢" iconBg="var(--infobg)" label="Departments" value={items.length} />
        <StatCard icon="👥" iconBg="var(--infobg)" label="Employees" value={totalEmployees} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label="Total Gross" value={formatMoney(totalGrossMinor)} />
        <StatCard icon="🧾" iconBg="var(--warnbg)" label="Total Net Pay" value={formatMoney(totalNetMinor)} />
      </StatGrid>

      <Card title="Register Lines">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by department…"
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No register lines"
          emptyMessage="No payroll register found for the given period or run. Try a different filter, or run payroll for this period first."
        />
      </Card>
    </main>
  );
}
