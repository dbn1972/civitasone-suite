import { getSchemes } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { SchemesTable, type SchemeRow } from "./SchemesTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function SchemesPage() {
  const result = await getSchemes();
  const { data: schemes } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const active = errored ? null : schemes.filter((s) => s.status === "active").length;
  const totalAllocation = errored ? null : schemes.reduce((sum, s) => sum + s.totalAllocation, 0);
  const totalReleased = errored ? null : schemes.reduce((sum, s) => sum + s.releasedAmount, 0);

  const rows: SchemeRow[] = schemes.map((s) => ({ ...s }));

  return (
    <>
      <PageHeader
        title="Schemes"
        subtitle="Physical & financial progress, beneficiaries — scheme-wise."
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={errored ? "—" : schemes.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active ?? "—"} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocation" value={totalAllocation === null ? "—" : formatMoney(totalAllocation)} />
        <StatCard icon="📤" iconBg="#fffaeb" label="Released" value={totalReleased === null ? "—" : formatMoney(totalReleased)} />
      </StatGrid>
      <Card title="Schemes">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "schemes" })} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🏛️" title="No schemes" message="No schemes have been configured yet." />
        ) : (
          <SchemesTable rows={rows} />
        )}
      </Card>
    </>
  );
}
