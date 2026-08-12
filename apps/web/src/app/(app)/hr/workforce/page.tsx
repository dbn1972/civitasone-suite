import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type HeadcountRow = { group_key: string; count: number } & Record<string, unknown>;
type RetirementRow = { employeeId: string; fullName: string; department?: string; dateOfBirth?: string; dateOfRetirement?: string; monthsLeft?: number } & Record<string, unknown>;

async function getHeadcount(): Promise<LoaderResult<HeadcountRow[]>> {
  return fetchJson<unknown, HeadcountRow[]>("/api/v1/hrms/workforce/headcount?groupBy=department", [], {
    telemetryKey: "hr.workforce.headcount",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: HeadcountRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getRetirements(): Promise<LoaderResult<RetirementRow[]>> {
  return fetchJson<unknown, RetirementRow[]>("/api/v1/hrms/workforce/retirement-forecast", [], {
    telemetryKey: "hr.workforce.retirement",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RetirementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function WorkforcePage() {
  const [hc, rt] = await Promise.all([getHeadcount(), getRetirements()]);
  const headcount = hc.data;
  const retirements = rt.data;
  const source = hc.source === "error" || rt.source === "error" ? "error" : hc.source;

  const totalHeadcount = headcount.reduce((s, r) => s + Number(r.count), 0);
  const retiringSoon = retirements.filter((r) => Number(r.monthsLeft ?? 99) <= 6).length;
  const retiring12 = retirements.filter((r) => Number(r.monthsLeft ?? 99) <= 12).length;

  const hcCols: { key: keyof HeadcountRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "group_key", label: "Department" },
    { key: "count", label: "Headcount", align: "right" },
  ];

  const rtCols: { key: keyof RetirementRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "fullName", label: "Officer Name" },
    { key: "department", label: "Department" },
    { key: "dateOfRetirement", label: "Retirement Date" },
    { key: "monthsLeft", label: "Months Left", align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Workforce Analytics"
        subtitle="Department-wise headcount, retirement forecasting, and vacancy pipeline."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label="Total Headcount" value={totalHeadcount} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Departments" value={headcount.length} />
        <StatCard icon="⏳" iconBg="#fff1f0" label="Retiring ≤6 months" value={retiringSoon} />
        <StatCard icon="📅" iconBg="#fffbe6" label="Retiring ≤12 months" value={retiring12} />
      </StatGrid>
      <Card title="Headcount by Department">
        <DataTable<HeadcountRow>
          columns={hcCols}
          rows={headcount}
          sortable
          filterable
          filterPlaceholder="Filter by department…"
          pageSize={15}
          emptyIcon="👥"
          emptyTitle="No headcount data"
          emptyMessage="Active employee counts grouped by department appear here for workforce planning and DPC preparation."
        />
      </Card>
      <div style={{ marginTop: 16 }}>
        <Card title="Upcoming Retirements">
          <DataTable<RetirementRow>
            columns={rtCols}
            rows={retirements}
            sortable
            filterable
            filterPlaceholder="Filter by name or department…"
            pageSize={10}
            emptyIcon="📅"
            emptyTitle="No retirements forecast"
            emptyMessage="Officers due for superannuation appear here 12 months in advance for succession and handover planning."
          />
        </Card>
      </div>
    </main>
  );
}
