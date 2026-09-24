import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantApplications } from "../_data";
import { ApplicationsTable } from "./ApplicationsTable";
import { FilterButton } from "./FilterButton";

export default async function GrantApplicationsPage() {
  const { data: applications, source } = await getGrantApplications();

  const active = applications.filter((a) => a.status === "active").length;
  const completed = applications.filter((a) => a.status === "completed").length;
  const totalSanctioned = applications.reduce((sum, a) => sum + a.totalAmount, 0);
  const totalDisbursed = applications.reduce((sum, a) => sum + a.disbursedAmount, 0);

  return (
    <>
      {/* UX: PageHeader's `back`/`backLabel` props already render the single
          breadcrumb (icon + "Grants" link) below — this page used to ALSO
          render its own manual <nav aria-label="Breadcrumb"> here, which
          doubled it into "← Grants ← Grants". Removed; do not re-add a
          second breadcrumb alongside the `back` prop. */}
      <PageHeader
        title="Grant Applications"
        subtitle="All applications across schemes with disbursement status."
        back="/grants"
        backLabel="Grants"
        help="grants"
        actions={
          <FilterButton />
        }
      />
      {/* UX-012: the data-source badge now lives inside ApplicationsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <div aria-label="Grant applications">
        <StatGrid>
          <StatCard icon="📄" iconBg="#f1f5f9" label="Total" value={applications.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
          <StatCard icon="🏁" iconBg="#e0f2fe" label="Completed" value={completed} />
          <StatCard
            icon="💰"
            iconBg="#fef9c3"
            label="Total Sanctioned"
            value={formatMoney(totalSanctioned)}
          />
        </StatGrid>
        <Card title="Applications">
          <ApplicationsTable applications={applications} source={source} />
        </Card>
      </div>
    </>
  );
}
