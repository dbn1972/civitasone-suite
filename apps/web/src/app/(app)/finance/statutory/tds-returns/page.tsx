import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceTDSReturns } from "@/app/_data/loaders";
import { fyQuarterCount, maskTdsPan, tdsStatusCounts } from "@/lib/finance/tdsDeductions";
import { TDSReturnsTable } from "./TDSReturnsTable";

/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-01: this reads the per-deduction vendor TDS
 * ledger (gl.finance_vendor_tds), one row per deduction. It is NOT a register of
 * filed returns (Form 26Q per FY + quarter), so it is titled and labelled as
 * deductions. A real returns source needs a product decision (TDS-RETURNS-04).
 */
export default async function TDSReturnsPage() {
  const { data, source } = await getFinanceTDSReturns();
  // GAP-FINANCE-STATUTORY-TDS-RETURNS-05: mask the PAN here, on the server, so
  // the full value never reaches the DOM, the offline cache or the CSV export.
  const deductions = maskTdsPan(data);
  const counts = tdsStatusCounts(deductions);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="TDS Deductions"
        subtitle="Vendor TDS deduction register, by section and quarter, with CSV export."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📑" iconBg="#e7edfd" label="Total Deductions" value={counts.total} />
        <StatCard icon="✂️" iconBg="#fffaeb" label="Deducted (not yet deposited)" value={counts.deducted} />
        <StatCard icon="🏦" iconBg="#eff6ff" label="Deposited" value={counts.deposited} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Filed" value={counts.filed} />
        <StatCard icon="📊" iconBg="#eff6ff" label="FY-Quarters" value={fyQuarterCount(deductions)} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside TDSReturnsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="TDS Deductions">
        <TDSReturnsTable returns={deductions} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
