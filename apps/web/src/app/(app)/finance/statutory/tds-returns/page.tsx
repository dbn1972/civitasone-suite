import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "@/app/_components/ds";
import { getFinanceTDSReturns } from "@/app/_data/loaders";
import { fyQuarterCount, maskTdsPan, tdsStatusCounts } from "@/lib/finance/tdsDeductions";
import { TDSReturnsTable } from "./TDSReturnsTable";
import { TdsFilingsPanel } from "./TdsFilingsPanel";
import { getTdsFilings } from "./tdsFilingsLoader";
import { FyFilter } from "../../_components/FyFilter";
import { currentFinancialYear, recentFinancialYears } from "@/lib/fiscalYear";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite } from "@/lib/finance/writeRoles";

/** finance-service TDS return filing is recorded by these roles (tds/filings-routes.ts FINANCE_ROLES). */
const TDS_FILING_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-01: this reads the per-deduction vendor TDS
 * ledger (gl.finance_vendor_tds), one row per deduction. It is NOT a register of
 * filed returns (Form 26Q per FY + quarter), so it is titled and labelled as
 * deductions. A real returns source needs a product decision (TDS-RETURNS-04).
 */
export default async function TDSReturnsPage({ searchParams }: { searchParams?: { fy?: string } }) {
  const { data, source } = await getFinanceTDSReturns();
  // GAP-FINANCE-STATUTORY-TDS-RETURNS-04: the filing register is per FY; ?fy= is validated against
  // the selectable list, never forwarded raw.
  const requestedFy = searchParams?.fy;
  const fy = requestedFy && recentFinancialYears().includes(requestedFy) ? requestedFy : currentFinancialYear();
  const filings = await getTdsFilings(fy);
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
        actions={<FyFilter />}
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
      <Card title={`Quarterly return filings · FY ${fy}`}>
        {filings.source === "error" ? (
          <div className="pad">
            <LoadErrorState result={filings} area="TDS return filings" backHref="/finance" />
          </div>
        ) : (
          <TdsFilingsPanel fy={fy} filings={filings.data} canFile={canWrite(getSessionRoles(), TDS_FILING_ROLES)} />
        )}
      </Card>
      <Card title="TDS Deductions">
        <TDSReturnsTable returns={deductions} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
