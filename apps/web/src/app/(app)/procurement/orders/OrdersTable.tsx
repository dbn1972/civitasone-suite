"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";

type Order = {
  id: string;
  poNo: string;
  vendor: string;
  amount: number;
  orderDate: string;
  deliveryDate?: string | null;
  grnStatus?: string | null;
  status: string;
} & Record<string, unknown>;

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  dispatched: "Dispatched",
  partial_grn: "Partial GRN",
  fully_received: "Fully Received",
  cancelled: "Cancelled",
  gem_placed: "GeM Placed",
};

type OrderRow = {
  id: string;
  poNo: string;
  vendor: string;
  amount: number;
  orderDate: string;
  deliveryDate: string;
  grnStatus: string;
  status: string;
} & Record<string, unknown>;

export function OrdersTable({ orders, source = "api" }: { orders: Order[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Order[]>(
    "procurement.orders",
    orders,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<OrderRow[]>(
    () =>
      rows.map((o) => ({
        id: o.id,
        poNo: o.poNo,
        vendor: o.vendor,
        amount: o.amount,
        orderDate: formatIndianDate(o.orderDate),
        deliveryDate: o.deliveryDate ? formatIndianDate(o.deliveryDate) : "—",
        grnStatus: o.grnStatus ?? "—",
        status: STATUS_LABELS[o.status] ?? o.status,
      })),
    [rows],
  );

  return (
    <Card title="Purchase orders">
      {/* UX-002: single source of truth — reads the same useSeededResource
          call as `rows`/`tableRows`, so it can never contradict this table
          (including the "no purchase orders found" empty state right below,
          which now only fires on a genuinely empty result, live or cached). */}
      <DataSourceBadge
        provenance={provenance ?? "live"}
        cachedAt={cachedAt}
        offline={offline}
        message={provenance === "error-no-data" ? "Couldn't load — showing nothing" : undefined}
      />
      {tableRows.length === 0 ? (
        <EmptyState icon="📦" title="No purchase orders found" message="Issue a PO to get started." />
      ) : (
        <DataTable<OrderRow>
          rows={tableRows}
          rowHref={(row) => `/procurement/orders/${row.id}`}
          sortable
          filterable
          filterPlaceholder="Search PO no, vendor, status…"
          pageSize={10}
          columns={[
            { key: "poNo", label: "PO No" },
            { key: "vendor", label: "Vendor" },
            { key: "amount", label: "Amount", align: "right", cellType: "amount" },
            { key: "orderDate", label: "Order Date" },
            { key: "deliveryDate", label: "Delivery Date" },
            { key: "grnStatus", label: "GRN Status" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
