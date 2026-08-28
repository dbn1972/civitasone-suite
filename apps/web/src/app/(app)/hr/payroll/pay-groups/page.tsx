import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreatePayGroupForm } from "./CreatePayGroupForm";
import { PayGroupCard } from "./PayGroupCard";

type Row = {
  id: string;
  name: string;
  frequency: string;
  pay_day_of_month: number;
  timezone: string;
  status: string;
  employeeCount?: number;
  salaryStructureName?: string;
  lastRevisionDate?: string;
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

export default async function PayGroupsPage() {
  const { data: groups, source } = await getData();

  const activeCount = groups.filter((g) => g.status === "active").length;
  const monthlyCount = groups.filter((g) => g.frequency === "monthly").length;
  const inactiveCount = groups.filter((g) => g.status !== "active").length;
  const totalEmployees = groups.reduce((s, g) => s + (Number(g.employeeCount) || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Groups"
        subtitle="Groups of employees paid on a common schedule (monthly, bi-weekly, or weekly)."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label="Total Pay Groups" value={groups.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Active" value={activeCount} />
        <StatCard icon="📅" iconBg="var(--warnbg)" label="Monthly Groups" value={monthlyCount} />
        <StatCard icon="⏸️" iconBg="var(--panel)" label="Inactive" value={inactiveCount} />
      </StatGrid>

      <CreatePayGroupForm />

      {groups.length === 0 ? (
        <Card title="Pay Groups">
          <EmptyState
            icon="👥"
            title="No pay groups yet"
            message="Create your first pay group using the form above to organize employees onto a common pay schedule."
          />
        </Card>
      ) : (
        <Card title="Pay Group Cards">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {groups.map((g) => (
              <PayGroupCard
                key={g.id}
                id={g.id}
                name={g.name}
                frequency={g.frequency}
                payDayOfMonth={g.pay_day_of_month}
                timezone={g.timezone}
                status={g.status}
                employeeCount={Number(g.employeeCount) || 0}
                associatedStructureName={g.salaryStructureName as string | undefined}
                lastRevisionDate={g.lastRevisionDate as string | undefined}
              />
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}
