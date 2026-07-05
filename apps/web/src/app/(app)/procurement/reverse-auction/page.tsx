import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
      <PageHeader
        title="Reverse Auctions"
        subtitle="Live and scheduled reverse auction events for competitive procurement."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
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
