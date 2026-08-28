import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { CreateCorrectionForm } from "./CreateCorrectionForm";

type Row = {
  id: string;
  employee_id: string;
  component: string;
  effective_from: string;
  old_value_minor: number | string;
  new_value_minor: number | string;
  arrears_minor: number | string;
  affected_periods: number;
  reason: string | null;
  status: string;
  created_at: string;
} & Record<string, unknown>;

type DisplayRow = Row & { effective_from_display: string };

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/corrections", [], {
    telemetryKey: "payroll.corrections",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CorrectionsPage() {
  const { data: items, source } = await getData();

  const columns: {
    key: keyof DisplayRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "employee_id", label: "Employee" },
    { key: "component", label: "Component" },
    { key: "effective_from_display", label: "Effective From" },
    { key: "old_value_minor", label: "Old Value", align: "right", cellType: "amount" },
    { key: "new_value_minor", label: "New Value", align: "right", cellType: "amount" },
    { key: "arrears_minor", label: "Arrears", align: "right", cellType: "amount" },
    { key: "affected_periods", label: "Periods", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  // Server-safe: DataTable's `render` prop cannot cross the server/client
  // boundary, so pre-format the display date into a plain string field.
  const rows = items.map((row) => ({ ...row, effective_from_display: formatIndianDate(row.effective_from) }));

  const pendingCount = items.filter((r) => r.status === "pending").length;
  const totalArrearsMinor = items.reduce((sum, r) => sum + Number(r.arrears_minor ?? 0), 0);
  const approvedCount = items.filter((r) => r.status === "approved").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Salary Corrections"
        subtitle="Retroactive salary component corrections and resulting arrears."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
        <StatCard icon="✏️" iconBg="var(--infobg)" label="Total Corrections" value={items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending" value={pendingCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label="Total Arrears" value={formatMoney(totalArrearsMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Approved" value={approvedCount} />
      </StatGrid>

      <CreateCorrectionForm />

      <Card title="Correction History">
        <DataTable<DisplayRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or component…"
          pageSize={15}
          emptyIcon="✏️"
          emptyTitle="No salary corrections yet"
          emptyMessage="Record a correction using the form above."
        />
      </Card>

      <Card title="Loss-of-Pay (LOP) Ledger" padding>
        <p style={{ fontSize: 13, color: "var(--ink2)" }}>
          Loss-of-pay adjustments are calculated automatically from approved leave and attendance records and applied during each payroll run. The adjusted amounts appear in the payroll register after processing.
        </p>
      </Card>
    </main>
  );
}
