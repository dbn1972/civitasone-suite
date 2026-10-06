import { PageHeader } from "../../../_components/ds";
import { getProcurementPreBid } from "../../../_data/loaders";
import { PreBidTable } from "./PreBidTable";

// GAP-PROCUREMENT-PRE-BID-01/02/03/05: the stat tiles and the table now live
// inside PreBidTable, driven by one useSeededResource call, so they cannot
// disagree and the all-zeros-on-error bug is gone. The unused Card import is
// removed. The tender cell links to the tender; scheduling a conference is not
// a capability this system has (pre-bid Q&A is modelled as query threads, not
// meetings), so the page is honestly read-only — no dead "Schedule" button.
export default async function PreBidPage() {
  const { data: conferences, source } = await getProcurementPreBid();

  return (
    <>
      <PageHeader
        title="Pre-Bid Conferences"
        subtitle="Pre-bid query threads and response tracking for open tenders (read-only). Open a tender to manage its queries."
      />

      <PreBidTable conferences={conferences} source={source} />
    </>
  );
}
