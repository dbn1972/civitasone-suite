import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import Link from "next/link";
import { mapOrders, type OrderRow } from "./mapOrders";

// NOTE ON SYSTEM OF RECORD (GAP-WORKS-ORDERS-04): this page lists the works
// lifecycle via works-service GET /api/v1/works/work-orders, while the
// proposals surface reads /v1/works/proposals. A work order and its originating
// proposal share the same aggregate id (works-service proposal module), so a
// row here links to /works/proposals/<id> for the full detail. The create flow
// lives on the proposals side (/works/proposals/new); there is no separate
// "new work order" form. Treat /works/proposals as the system of record for the
// lifecycle; this screen is the work-order-centric read view of it.

async function getOrders(): Promise<LoaderResult<OrderRow[]>> {
  // GAP-WORKS-ORDERS-06: request an explicit pageSize (backend max 200). The
  // service defaults to pageSize=20, so without this the list silently showed
  // only the first 20 work orders. 200 covers the single-page register this
  // screen is; a larger tenant would need real pagination from meta.total.
  return fetchJson<unknown, OrderRow[]>("/api/v1/works/work-orders?pageSize=200", [], {
    telemetryKey: "works.orders",
    mapResponse: mapOrders,
  });
}

const columns: {
  key: keyof OrderRow;
  label: string;
  cellType?: "status" | "amount";
  align?: "right";
}[] = [
  { key: "workNumber",    label: "Work No." },
  { key: "description",   label: "Description" },
  { key: "status",        label: "Status",    cellType: "status" },
  { key: "category",      label: "Category" },
  { key: "estimatedCost", label: "Est. Cost", cellType: "amount", align: "right" },
];

export default async function WorkOrdersPage() {
  const { data: orders, source } = await getOrders();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Work Orders"
        subtitle="All civil/infrastructure work orders in the current lifecycle."
        back="/works"
        backLabel="Works & Billing"
        actions={
          <>
            {source === "error" && <DataSourceBadge source="error" />}
            <Link href="/works/proposals/new" className="btn secondary">
              New Proposal
            </Link>
          </>
        }
      />

      <Card title={`Work Orders (${orders.length})`}>
        <DataTable<OrderRow>
          columns={columns}
          rows={orders}
          sortable
          filterable
          filterPlaceholder="Filter by work number, description…"
          pageSize={20}
          rowHref={(r) => `/works/proposals/${r.id}`}
          emptyIcon="📋"
          emptyTitle="No work orders yet"
          emptyMessage="Create a work proposal to begin the lifecycle."
        />
      </Card>
    </div>
  );
}
