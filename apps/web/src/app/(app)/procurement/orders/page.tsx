import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { getProcurementPOs } from "../../../_data/loaders";
import { getSessionRoles, hasAnyRole, PROCUREMENT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { OrdersTable } from "./OrdersTable";

export default async function OrdersPage() {
  const { data: orders, source } = await getProcurementPOs({ limit: 500 });

  // GAP-PROCUREMENT-ORDERS-03: creating a PO is a controlled maker action; the
  // service 403s a read-only role (audit_officer/finance_officer) on POST /pos.
  // Only offer "+ New PO" to a role that can actually create one. The service
  // remains the authority (direct POST still 403s); this removes a dead-end.
  const canCreate = hasAnyRole(getSessionRoles(), PROCUREMENT_WRITE_ROLES);

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Operational order book with GRN status and delivery tracking."
        actions={canCreate ? <Link href="/procurement/orders/new" className="btn primary">+ New PO</Link> : undefined}
      />

      {/* GAP-PROCUREMENT-ORDERS-01/02: stats are computed INSIDE OrdersTable from
          the same seeded resource the table renders, so on a fetch error they
          read "—" (not a fabricated 0 / ₹0.00) and can never contradict the
          rows shown. */}
      <OrdersTable orders={orders} source={source} />
    </>
  );
}
