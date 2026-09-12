import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreatePayGroupForm } from "./CreatePayGroupForm";
import { PayGroupCard } from "./PayGroupCard";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

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
  const result = await getData();
  const { data: groups } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const activeCount = errored ? null : groups.filter((g) => g.status === "active").length;
  const monthlyCount = errored ? null : groups.filter((g) => g.frequency === "monthly").length;
  const inactiveCount = errored ? null : groups.filter((g) => g.status !== "active").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Groups"
        subtitle="Groups of employees paid on a common schedule (monthly, bi-weekly, or weekly)."
        back="/hr/payroll"
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label="Total Pay Groups" value={errored ? "—" : groups.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Active" value={activeCount ?? "—"} />
        <StatCard icon="📅" iconBg="var(--warnbg)" label="Monthly Groups" value={monthlyCount ?? "—"} />
        <StatCard icon="⏸️" iconBg="var(--panel)" label="Inactive" value={inactiveCount ?? "—"} />
      </StatGrid>

      <CreatePayGroupForm />

      {errored ? (
        <Card title="Pay Groups">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pay groups" })} backHref="/hr/payroll" />
          </div>
        </Card>
      ) : groups.length === 0 ? (
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
