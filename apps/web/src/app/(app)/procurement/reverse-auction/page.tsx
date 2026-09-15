import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementReverseAuctions } from "../../../_data/loaders";
import { ReverseAuctionTable } from "./ReverseAuctionTable";

export default async function ReverseAuctionPage() {
  const { data: auctions, source } = await getProcurementReverseAuctions();

  const live = auctions.filter((a) => a.status === "Live").length;
  const scheduled = auctions.filter((a) => a.status === "Scheduled").length;
  const awarded = auctions.filter((a) => a.status === "Awarded").length;

  return (
    <>
      {/* UX-012: the data-source badge now lives inside ReverseAuctionTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Reverse Auctions"
        subtitle="Live and scheduled reverse auction events for competitive procurement."
      />

      <StatGrid>
        <StatCard icon="🔨" iconBg="#eef2ff" label="Live Auctions" value={live} />
        <StatCard icon="📅" iconBg="#ecfdf3" label="Scheduled" value={scheduled} />
        <StatCard icon="💰" iconBg="#fffaeb" label="Total Events" value={auctions.length} />
        <StatCard icon="🏆" iconBg="#fce7ee" label="Awarded" value={awarded} />
      </StatGrid>

      <ReverseAuctionTable auctions={auctions} source={source} />
    </>
  );
}
