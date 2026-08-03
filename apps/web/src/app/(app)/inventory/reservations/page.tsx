import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getInventoryReservations } from "../_data";
import { ReservationsTable } from "../ReservationsTable";

export const dynamic = "force-dynamic";

export default async function InventoryReservationsPage() {
  const { data: reservations, source } = await getInventoryReservations();
  const active = reservations.filter((r) => r.status === "active").length;
  const totalQty = reservations.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader
        title="Stock Reservations"
        subtitle="Quantities held against indents or POs — reduces available-to-promise without changing on-hand."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Inventory stock reservations">
        <StatGrid>
          <StatCard icon="🔒" iconBg="#fef3c7" label="Reservations" value={reservations.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
          <StatCard icon="🔢" iconBg="#f1f5f9" label="Total Qty Held" value={totalQty} />
        </StatGrid>
        <Card title="Reservations">
          <ReservationsTable reservations={reservations} source={source} />
        </Card>
      </main>
    </>
  );
}
