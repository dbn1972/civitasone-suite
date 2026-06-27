import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function ReverseAuctionPage() {
  type Row = { item: string; startPrice: number; currentLowest: number; bidders: number; timeRemaining: string; status: string };

  const rows: Row[] = [
    { item: "Desktop Computers (Qty: 500)", startPrice: 4500000, currentLowest: 3850000, bidders: 7, timeRemaining: "2h 15m", status: "Live" },
    { item: "Office Furniture – Modular Workstations", startPrice: 1200000, currentLowest: 980000, bidders: 5, timeRemaining: "45m", status: "Live" },
    { item: "CCTV Surveillance System", startPrice: 2800000, currentLowest: 2450000, bidders: 4, timeRemaining: "—", status: "Closed" },
    { item: "Paper & Stationery (Annual)", startPrice: 850000, currentLowest: 720000, bidders: 9, timeRemaining: "—", status: "Awarded" },
    { item: "Server Rack Infrastructure", startPrice: 6200000, currentLowest: 5100000, bidders: 3, timeRemaining: "5h 30m", status: "Live" },
    { item: "Diesel Generator 250 KVA", startPrice: 3400000, currentLowest: 3400000, bidders: 0, timeRemaining: "23h 10m", status: "Scheduled" },
    { item: "Network Switches & Cabling", startPrice: 1800000, currentLowest: 1550000, bidders: 6, timeRemaining: "—", status: "Closed" },
  ];

  const columns = [
    { key: "item" as const, label: "Item" },
    { key: "startPrice" as const, label: "Start Price (₹)", align: "right" as const, cellType: "amount" as const },
    { key: "currentLowest" as const, label: "Current Lowest (₹)", align: "right" as const, cellType: "amount" as const },
    { key: "bidders" as const, label: "Bidders", align: "center" as const },
    { key: "timeRemaining" as const, label: "Time Remaining" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Reverse Auctions" subtitle="Live and scheduled reverse auction events for competitive procurement." back="/procurement" />
      <StatGrid>
        <StatCard icon="🔨" iconBg="#eef2ff" label="Live Auctions" value={3} />
        <StatCard icon="📅" iconBg="#ecfdf3" label="Scheduled" value={1} />
        <StatCard icon="💰" iconBg="#fffaeb" label="Avg. Savings" value="18%" />
        <StatCard icon="🏆" iconBg="#fce7ee" label="Awarded This Month" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Auction Events</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
