import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceSanctions } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { SanctionsTable } from "./SanctionsTable";
import { SanctionCreateAction } from "../../_components/FinanceActions";

export default async function SanctionsPage() {
  const { data: sanctions, source } = await getFinanceSanctions();

  const approved = sanctions.filter((s) => s.status === "approved").length;
  const pending = sanctions.filter((s) => s.status === "pending").length;
  // amount is a minor-unit (paise) decimal string — sum as BigInt so
  // formatMoney() gets the right scale and large totals can't drift.
  const totalAmount = sanctions.reduce((sum, s) => sum + BigInt(s.amount || "0"), 0n);

  return (
    <>
      <PageHeader
        title="Sanction Management"
        subtitle="Administrative &amp; financial sanctions with budget check."
        actions={
          <>
            <SanctionCreateAction />
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🖊️" iconBg="#e7edfd" label="Active Sanctions" value={sanctions.length} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Sanctioned (FY)" value={formatMoney(totalAmount)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={pending} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Approved" value={approved} delta="approved" up={true} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside SanctionsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="Administrative & financial sanctions">
        <SanctionsTable sanctions={sanctions} source={source} />
      </Card>
    </>
  );
}
