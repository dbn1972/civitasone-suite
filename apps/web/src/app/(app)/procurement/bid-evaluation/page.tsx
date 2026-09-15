import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementBidEvaluations } from "../../../_data/loaders";
import { BidEvaluationTable } from "./BidEvaluationTable";

export default async function BidEvaluationPage() {
  const { data: evaluations, source } = await getProcurementBidEvaluations();

  const recommended = evaluations.filter((e) => e.status === "Recommended").length;
  const underReview = evaluations.filter((e) => e.status === "Under Review").length;
  const uniqueTenders = new Set(evaluations.map((e) => e.tender)).size;

  return (
    <>
      {/* UX-012: the data-source badge now lives inside BidEvaluationTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Bid Evaluation"
        subtitle="Technical and financial scoring matrix for open tenders."
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Active Evaluations" value={uniqueTenders} />
        <StatCard icon="🏢" iconBg="#ecfdf3" label="Total Bidders" value={evaluations.length} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Recommended" value={recommended} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Under Review" value={underReview} />
      </StatGrid>

      <BidEvaluationTable evaluations={evaluations} source={source} />
    </>
  );
}
