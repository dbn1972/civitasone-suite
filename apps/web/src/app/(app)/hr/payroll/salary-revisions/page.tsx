import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreateSalaryRevisionForm } from "./CreateSalaryRevisionForm";

type Row = {
  id: string;
  employee_id: string;
  effective_date: string;
  old_basic_minor: number | string;
  new_basic_minor: number | string;
  old_gross_minor: number | string;
  new_gross_minor: number | string;
  revision_type: string;
  order_no: string | null;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/salary-revisions", [], {
    telemetryKey: "payroll.salary-revisions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

const REVISION_TYPE_LABEL: Record<string, string> = {
  annual_increment: "Annual Increment",
  promotion: "Promotion",
  special: "Special",
  pay_commission: "Pay Commission",
  market_correction: "Market Correction",
};

export default async function SalaryRevisionsPage() {
  const { data: rawItems, source } = await getData();

  const items = rawItems.map((r) => ({
    ...r,
    revisionTypeLabel: REVISION_TYPE_LABEL[r.revision_type] ?? r.revision_type,
  }));
  type Row2 = (typeof items)[number];

  const columns: { key: keyof Row2 & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "employee_id", label: "Employee" },
    { key: "effective_date", label: "Effective Date" },
    { key: "revisionTypeLabel", label: "Revision Type" },
    { key: "old_basic_minor", label: "Old Basic", align: "right", cellType: "amount" },
    { key: "new_basic_minor", label: "New Basic", align: "right", cellType: "amount" },
    { key: "new_gross_minor", label: "New Gross", align: "right", cellType: "amount" },
    { key: "order_no", label: "Order No." },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Salary Revisions"
        subtitle="Basic and gross salary revision history — increments, promotions, and pay-commission fixation."
        back="/hr/payroll"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📈" iconBg="#e6f0ff" label="Total Revisions" value={items.length} />
      </StatGrid>

      <CreateSalaryRevisionForm />

      <Card title="Salary Revision History">
        <DataTable<Row2>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee or order no…"
          pageSize={15}
          emptyIcon="📈"
          emptyTitle="No salary revisions yet"
          emptyMessage="Create your first salary revision using the form above."
        />
      </Card>
    </main>
  );
}
