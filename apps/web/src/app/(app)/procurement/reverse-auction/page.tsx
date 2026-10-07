import { PageHeader } from "../../../_components/ds";
import { getProcurementReverseAuctions } from "../../../_data/loaders";
import { ReverseAuctionTable } from "./ReverseAuctionTable";

// GAP-PROCUREMENT-REVERSE-AUCTION-01/04/05: the stat tiles now live inside
// ReverseAuctionTable, computed from the SAME useSeededResource rows the table
// renders (and from a client-side periodic refresh while any auction is Live),
// so they can never show a fabricated row of 0s above an error, the Total
// Events tile is no longer styled as money, and a Total Savings tile is shown.
export default async function ReverseAuctionPage() {
  const { data: auctions, source } = await getProcurementReverseAuctions();

  return (
    <>
      <PageHeader
        title="Reverse Auctions"
        subtitle="Live and scheduled reverse auction events for competitive procurement."
      />

      <ReverseAuctionTable auctions={auctions} source={source} />
    </>
  );
}
