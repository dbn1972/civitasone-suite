import { PageHeader } from "@/app/_components/ds";
import { getInventoryReservations } from "../_data";
import { ReservationsTable } from "../ReservationsTable";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-INVENTORY-RESERVATIONS-01: stats, provenance badge and the failure state live in
// ReservationsTable so they all read ONE useSeededResource call -- this page no longer
// derives zero-filled stats from a failed fetch.
export default async function InventoryReservationsPage() {
  const { data, source } = await getInventoryReservations();

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/inventory">Inventory</a>
      </nav>
      <PageHeader title="Stock Reservations" subtitle="Quantities held against indents or POs — reduces available-to-promise without changing on-hand." />
      <ReservationsTable reservations={data} source={source} />
    </>
  );
}
