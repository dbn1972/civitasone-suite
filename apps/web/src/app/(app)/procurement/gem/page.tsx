import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function GemPage() {
  type Row = { orderId: string; item: string; supplier: string; amount: number; deliveryDate: string; gemStatus: string };

  const rows: Row[] = [
    { orderId: "GEMC-511-2024-00456", item: "HP LaserJet Printers (20 units)", supplier: "CompuMart Technologies", amount: 1240000, deliveryDate: "2025-02-15", gemStatus: "Delivered" },
    { orderId: "GEMC-511-2024-00512", item: "Tata Nexon EV (Fleet)", supplier: "Tata Motors Ltd", amount: 8400000, deliveryDate: "2025-03-10", gemStatus: "In Transit" },
    { orderId: "GEMC-511-2024-00587", item: "Office Chairs – Ergonomic", supplier: "Godrej Interio", amount: 560000, deliveryDate: "2025-01-28", gemStatus: "Delivered" },
    { orderId: "GEMC-511-2024-00623", item: "Cloud Hosting – Annual", supplier: "NIC Cloud Services", amount: 3200000, deliveryDate: "2025-04-01", gemStatus: "Order Placed" },
    { orderId: "GEMC-511-2024-00641", item: "Biometric Attendance Devices", supplier: "Matrix Comsec", amount: 480000, deliveryDate: "2025-02-20", gemStatus: "Shipped" },
    { orderId: "GEMC-511-2024-00678", item: "Solar Panels 10KW", supplier: "Vikram Solar Ltd", amount: 2100000, deliveryDate: "2025-03-25", gemStatus: "Order Placed" },
    { orderId: "GEMC-511-2024-00702", item: "Paper A4 (5000 Reams)", supplier: "JK Paper Ltd", amount: 375000, deliveryDate: "2025-01-30", gemStatus: "Delivered" },
  ];

  const columns = [
    { key: "orderId" as const, label: "GeM Order ID" },
    { key: "item" as const, label: "Item" },
    { key: "supplier" as const, label: "Supplier" },
    { key: "amount" as const, label: "Amount (₹)", align: "right" as const, cellType: "amount" as const },
    { key: "deliveryDate" as const, label: "Delivery Date" },
    { key: "gemStatus" as const, label: "GeM Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="GeM Integration" subtitle="Government e-Marketplace orders and delivery tracking." back="/procurement" />
      <StatGrid>
        <StatCard icon="🛒" iconBg="#eef2ff" label="Total Orders" value={7} />
        <StatCard icon="📦" iconBg="#ecfdf3" label="Delivered" value={3} />
        <StatCard icon="🚚" iconBg="#fffaeb" label="In Transit" value={2} />
        <StatCard icon="💰" iconBg="#fce7ee" label="Total Value" value="₹1.64 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>GeM Orders</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
