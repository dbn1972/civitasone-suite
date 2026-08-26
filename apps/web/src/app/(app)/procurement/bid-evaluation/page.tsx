import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
      <PageHeader
        title="Bid Evaluation"
        subtitle="Technical and financial scoring matrix for open tenders."
        actions={source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
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
