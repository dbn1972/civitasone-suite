import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreatePayGroupForm } from "./CreatePayGroupForm";

type Row = {
  id: string;
  name: string;
  frequency: string;
  pay_day_of_month: number;
  timezone: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/pay-groups", [], {
    telemetryKey: "payroll.pay-groups",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  bi_weekly: "Bi-weekly",
  weekly: "Weekly",
};

export default async function PayGroupsPage() {
  const { data: groups, source } = await getData();

  const rows = groups.map((g) => ({
    ...g,
    frequencyLabel: FREQUENCY_LABEL[g.frequency] ?? g.frequency,
  }));
  type Row2 = (typeof rows)[number];

  const columns: { key: keyof Row2 & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "name", label: "Pay Group" },
    { key: "frequencyLabel", label: "Frequency" },
    { key: "pay_day_of_month", label: "Pay Day", align: "right" },
    { key: "timezone", label: "Timezone" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Groups"
        subtitle="Groups of employees paid on a common schedule (monthly, bi-weekly, or weekly)."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label="Total Pay Groups" value={groups.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={groups.filter((g) => g.status === "active").length} />
      </StatGrid>

      <CreatePayGroupForm />

      <Card title="Pay Groups">
        <DataTable<Row2>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by name…"
          pageSize={15}
          emptyIcon="👥"
          emptyTitle="No pay groups yet"
          emptyMessage="Create your first pay group using the form above."
        />
      </Card>
    </main>
  );
}
