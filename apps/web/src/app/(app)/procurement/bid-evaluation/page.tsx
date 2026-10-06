import { PageHeader } from "../../../_components/ds";
import { getProcurementBidEvaluations } from "../../../_data/loaders";
import { BidEvaluationTable } from "./BidEvaluationTable";

export default async function BidEvaluationPage() {
  // GAP-PROCUREMENT-BID-EVALUATION-02: the page only fetches and passes
  // data+source. Both the stat cards and the table now derive from the SAME
  // useSeededResource rows inside the client component, so counts can never
  // disagree with the rows on screen (previously stats read the raw server
  // list while the table read a possibly-cached list).
  const { data: evaluations, source } = await getProcurementBidEvaluations();

  return (
    <>
      <PageHeader
        title="Bid Evaluation"
        subtitle="Technical and financial scoring matrix for open tenders."
      />
      <BidEvaluationTable evaluations={evaluations} source={source} />
    </>
  );
}
