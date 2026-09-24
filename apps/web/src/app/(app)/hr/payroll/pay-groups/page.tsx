import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CreatePayGroupForm } from "./CreatePayGroupForm";
import { PayGroupCard } from "./PayGroupCard";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("payrollPayGroups");
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
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? "—" : groups.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={activeCount ?? "—"} />
        <StatCard icon="📅" iconBg="var(--warnbg)" label={t("statMonthly")} value={monthlyCount ?? "—"} />
        <StatCard icon="⏸️" iconBg="var(--panel)" label={t("statInactive")} value={inactiveCount ?? "—"} />
      </StatGrid>

      <CreatePayGroupForm />

      {errored ? (
        <Card title={t("cardTitle")}>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pay groups" })} backHref="/hr/payroll" />
          </div>
        </Card>
      ) : groups.length === 0 ? (
        <Card title={t("cardTitle")}>
          <EmptyState
            icon="👥"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        </Card>
      ) : (
        <Card title={t("cardsTitle")}>
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
