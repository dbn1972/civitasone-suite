import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CreateFlexPlanForm } from "./CreateFlexPlanForm";
import { ElectFlexBenefitForm } from "./ElectFlexBenefitForm";

// Note: the payroll-service only exposes POST /v1/payroll/flex-benefits/plans (create) —
// there is no GET list-all-plans endpoint. The only list endpoint available is the
// employee's own elections, so that is what this screen renders.
type ElectionRow = {
  id: string;
  plan_id: string;
  plan_name: string;
  fy: string;
  total_elected_minor: number | string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<ElectionRow[]>> {
  return fetchJson<unknown, ElectionRow[]>("/api/v1/payroll/flex-benefits/my-elections", [], {
    telemetryKey: "payroll.flex-benefits.my-elections",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ElectionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function FlexBenefitsPage() {
  const { data: elections, source } = await getData();

  const columns: { key: keyof ElectionRow & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "plan_name", label: "Plan" },
    { key: "fy", label: "Financial Year" },
    { key: "total_elected_minor", label: "Total Elected", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const totalElectedMinor = elections.reduce((sum, r) => sum + Number(r.total_elected_minor ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Flex Benefits"
        subtitle="Flexible-benefit plans and employee component elections."
        back="/hr/payroll"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🧩" iconBg="#e6f0ff" label="My Elections" value={elections.length} />
        <StatCard icon="💰" iconBg="#e6f7f0" label="Total Elected" value={formatMoney(totalElectedMinor)} />
      </StatGrid>

      <CreateFlexPlanForm />
      <ElectFlexBenefitForm />

      <Card title="My Flex Benefit Elections">
        <DataTable<ElectionRow>
          columns={columns}
          rows={elections}
          sortable
          filterable
          filterPlaceholder="Filter by plan or FY…"
          pageSize={15}
          emptyIcon="🧩"
          emptyTitle="No flex benefit elections yet"
          emptyMessage="Create a plan and submit an election using the forms above."
        />
      </Card>
    </main>
  );
}
