import { getSchemes } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { SchemesTable, type SchemeRow } from "./SchemesTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function SchemesPage() {
  const result = await getSchemes();
  const { data: schemes } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const active = errored ? null : schemes.filter((s) => s.status === "active").length;
  // GAP-PROJECTS-SCHEMES-03: an empty scheme list reduced over [] to 0, so the
  // money tiles rendered a fabricated "₹0.00" instead of the honest "—" used
  // on error (UX-006: no data is not a real zero). Treat "no schemes" the same
  // as errored for the money/active tiles.
  const noData = errored || resource.status === "empty";
  // GAP2-PROJECTS-SCHEMES-MONEY-04: totalAllocation/releasedAmount are now
  // bigint MINOR units (paise) as strings (same unit as the detail endpoint),
  // so sum them as BigInt and render with formatMoney — not formatRupees.
  const totalAllocation = noData ? null : schemes.reduce((sum, s) => sum + BigInt(s.totalAllocation || "0"), 0n);
  const totalReleased = noData ? null : schemes.reduce((sum, s) => sum + BigInt(s.releasedAmount || "0"), 0n);

  const rows: SchemeRow[] = schemes.map((s) => ({ ...s }));

  return (
    <>
      <PageHeader
        title="Schemes"
        subtitle="Scheme-wise allocation, releases and project counts."
        back="/projects"
        backLabel="Back to Projects"
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Total" value={errored ? "—" : schemes.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active ?? "—"} />
        {/* GAP2-PROJECTS-SCHEMES-MONEY-04: totalAllocation/releasedAmount are
            bigint MINOR units (paise) as strings, summed as BigInt and rendered
            with formatMoney — the same unit the detail endpoint uses, replacing
            the old whole-rupee + formatRupees workaround (COMP-017). */}
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocation" value={totalAllocation === null ? "—" : formatMoney(totalAllocation)} />
        <StatCard icon="📤" iconBg="#fffaeb" label="Released" value={totalReleased === null ? "—" : formatMoney(totalReleased)} />
      </StatGrid>
      <Card title="Schemes">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "schemes" })} backHref="/projects" />
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
