"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Order[]>(
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

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Purchase orders">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
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
