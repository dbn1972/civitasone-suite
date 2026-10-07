import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState } from "../../../../_components/ds";
import { getProcurementReverseAuctionById } from "../../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { formatMoney, formatIndianDateTime } from "@/lib/formatters";

// GAP-PROCUREMENT-REVERSE-AUCTION-02: a read-only detail page so the register's
// rows are no longer a dead end. Lifecycle actions (extend/close/award) are a
// separate, larger scope requiring confirmed backend endpoints + audit/permission
// gates, recorded for HUMAN REVIEW — this page deliberately offers none.
export default async function ReverseAuctionDetailPage({ params }: { params: { id: string } }) {
  const { data: auction, source } = await getProcurementReverseAuctionById(params.id);

  if (!auction) {
    return (
      <>
        <PageHeader title="Reverse Auction" back="/procurement/reverse-auction" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "reverse auction" })} backHref="/procurement/reverse-auction" />
        ) : (
          <EmptyState icon="🔨" title="Auction not found" message="This auction may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={auction.auctionNo || auction.item}
        subtitle={auction.item}
        back="/procurement/reverse-auction"
        actions={
          <>
            <StatusPill status={auction.status} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <Card title="Auction details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Auction No</span>
            <span className="mono">{auction.auctionNo || "—"}</span>
          </div>
          <div className="field">
            <span className="label">Indent ref</span>
            <span>{auction.indentRef || "—"}</span>
          </div>
          <div className="field">
            <span className="label">Start (reserve) price</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(auction.startPriceMinor)}</span>
          </div>
          <div className="field">
            <span className="label">Current lowest</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(auction.currentLowestMinor)}</span>
          </div>
          <div className="field">
            <span className="label">Savings vs reserve</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(auction.savingsMinor)}</span>
          </div>
          <div className="field">
            <span className="label">Bidders</span>
            <span>{auction.bidders}</span>
          </div>
          <div className="field">
            <span className="label">Ends at</span>
            <span>{formatIndianDateTime(auction.endsAt)}</span>
          </div>
        </div>
      </Card>
    </>
  );
}
