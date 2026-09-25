import { getSchemes } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatRupees } from "@/lib/formatters";
import { SchemesTable, type SchemeRow } from "./SchemesTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function SchemesPage() {
  const result = await getSchemes();
  const { data: schemes } = result;
  const resource = toResourceState(result);
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
        {/* COMP-017: totalAllocation/releasedAmount are whole-rupee numbers
            (project-service's listSchemeSummaries() / SchemeSummarySchema),
            not minor units -- formatMoney() was treating this dashboard sum
            as paise and under-displaying it 100x. formatRupees() matches
            the per-row fix in SchemesTable.tsx (see its column defs for the
            full rationale); this stat card sums the same already-rupee
            fields each row renders. */}
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocation" value={totalAllocation === null ? "—" : formatRupees(totalAllocation)} />
        <StatCard icon="📤" iconBg="#fffaeb" label="Released" value={totalReleased === null ? "—" : formatRupees(totalReleased)} />
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
