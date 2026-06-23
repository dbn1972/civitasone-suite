import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getProcurementPOs } from "../../../_data/loaders";
import type { ListSearchParams } from "../_components/listUtils";
import { OrdersTable } from "./OrdersTable";

export default async function OrdersPage({ searchParams }: { searchParams: ListSearchParams & { vendor?: string } }) {
  const { data: orders, source } = await getProcurementPOs({ limit: 500, q: searchParams.q });

  const active = orders.filter((o) => o.status === "approved" || o.status === "partial_grn" || o.status === "dispatched").length;
  const totalAmount = orders.reduce((s, o) => s + o.amount, 0);
  const fullyReceived = orders.filter((o) => o.status === "fully_received").length;

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Operational order book with GRN status and delivery tracking."
        actions={
          <>
            <Link href="/procurement/orders/new" className="btn primary">+ New PO</Link>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📦" iconBg="#e7edfd" label="Total POs" value={orders.length} />
        <StatCard icon="🔄" iconBg="#eff6ff" label="Active" value={active} />
        <StatCard icon="💰" iconBg="#fffaeb" label="Order Value" value={`₹${(totalAmount / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Fully Received" value={fullyReceived} />
      </StatGrid>

      <OrdersTable orders={orders} source={source} />
    </>
  );
}
