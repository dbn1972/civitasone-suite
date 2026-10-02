import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceCheques } from "@/app/_data/loaders";
import { chequeStatusCounts } from "@/lib/finance/chequeRegister";
import { ChequesTable } from "./ChequesTable";

export default async function ChequesPage() {
  const { data: cheques, source } = await getFinanceCheques();
  // GAP-FINANCE-TREASURY-CHEQUES-04: every lifecycle status is counted, so the cards
  // add up to Total; a failed load shows a dash, not a misleading 0.
  const c = chequeStatusCounts(cheques);
  const loaded = source !== "error";
  const n = (v: number) => (loaded ? v : "—");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Cheque / DD Register"
        subtitle="Cheque and demand draft register with clearance and bounce tracking."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total Instruments" value={n(c.total)} />
        <StatCard icon="📤" iconBg="#eff6ff" label="Issued (outstanding)" value={n(c.issued)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Presented" value={n(c.presented)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Cleared" value={n(c.cleared)} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Bounced" value={n(c.bounced)} />
        <StatCard icon="🚫" iconBg="#f2f4f7" label="Cancelled / other" value={n(c.cancelled + c.other)} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside ChequesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Cheque Register">
        <ChequesTable cheques={cheques} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
