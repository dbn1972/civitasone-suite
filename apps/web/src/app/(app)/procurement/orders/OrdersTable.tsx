"use client";

import { useMemo, useState } from "react";
import { Card, DataTable, EmptyState, StatGrid, StatCard, Segmented, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate, formatMoney, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import {
  PO_STATUS_LABELS,
  grnStatusLabel,
  COMMITTED_PO_STATUSES,
  isDeliveryOverdue,
} from "@/lib/procurement-status";

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

// Statuses that count toward the "In fulfilment" stat (an order that has been
// released and is working its way to delivery). Explicit so the label can
// honestly say what it counts (GAP-PROCUREMENT-ORDERS-04).
const IN_FULFILMENT_STATUSES = new Set(["approved", "partial_grn", "dispatched", "gem_placed"]);

const ALL_FILTER = "All";

export function OrdersTable({ orders, source = "api" }: { orders: Order[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Order[]>(
    "procurement.orders",
    orders,
    source,
    (d) => d.length === 0,
  );

  const [statusFilter, setStatusFilter] = useState<string>(ALL_FILTER);

  const erroredNoData = provenance === "error-no-data";

  // GAP-PROCUREMENT-ORDERS-02: stats are derived from the SAME `rows` the table
  // renders (not a separate server slice), so a stat can never contradict a
  // visible row. Sums are in integer paise.
  const stats = useMemo(() => {
    const totalPos = rows.length;
    const inFulfilment = rows.filter((o) => IN_FULFILMENT_STATUSES.has(o.status)).length;
    const fullyReceived = rows.filter((o) => o.status === "fully_received").length;
    // Committed value excludes draft/cancelled POs. Integer paise accumulation.
    const committedMinor = rows
      .filter((o) => COMMITTED_PO_STATUSES.has(o.status))
      .reduce((s, o) => s + (Number.isFinite(o.amount) ? Math.round(o.amount) : 0), 0);
    return { totalPos, inFulfilment, fullyReceived, committedMinor };
  }, [rows]);

  // GAP-PROCUREMENT-ORDERS-04: per-status counts drive the filter chips.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of rows) counts[o.status] = (counts[o.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  const chipOptions = useMemo(() => {
    const present = Object.keys(PO_STATUS_LABELS).filter((k) => (statusCounts[k] ?? 0) > 0);
    return [
      `${ALL_FILTER} (${rows.length})`,
      ...present.map((k) => `${PO_STATUS_LABELS[k]} (${statusCounts[k]})`),
    ];
  }, [statusCounts, rows.length]);

  // Map a chip label back to the status key it filters on (or ALL).
  const labelToStatus = useMemo(() => {
    const m = new Map<string, string>();
    m.set(ALL_FILTER, ALL_FILTER);
    for (const [key, label] of Object.entries(PO_STATUS_LABELS)) m.set(label, key);
    return m;
  }, []);

  const selectedChip = useMemo(() => {
    if (statusFilter === ALL_FILTER) return `${ALL_FILTER} (${rows.length})`;
    const label = PO_STATUS_LABELS[statusFilter];
    return `${label} (${statusCounts[statusFilter] ?? 0})`;
  }, [statusFilter, statusCounts, rows.length]);

  const today = todayIST();

  const tableRows = useMemo<OrderRow[]>(() => {
    const filtered = statusFilter === ALL_FILTER ? rows : rows.filter((o) => o.status === statusFilter);
    return filtered.map((o) => {
      const overdue = isDeliveryOverdue(o.deliveryDate, o.status, today);
      return {
        id: o.id,
        poNo: o.poNo,
        vendor: o.vendor,
        amount: o.amount,
        orderDate: formatIndianDate(o.orderDate),
        deliveryDate: o.deliveryDate
          ? `${formatIndianDate(o.deliveryDate)}${overdue ? " · Overdue" : ""}`
          : "—",
        grnStatus: grnStatusLabel(o.grnStatus),
        // Raw status key — DataTable's cellType="status" maps it through
        // statusLabels={PO_STATUS_LABELS} to the human label (incl. gem_placed).
        status: o.status,
      };
    });
  }, [rows, statusFilter, today]);

  return (
    <>
      <StatGrid>
        <StatCard icon="📦" tone="info" label="Total POs" value={erroredNoData ? null : stats.totalPos} />
        <StatCard
          icon="🔄"
          tone="info"
          label="In fulfilment"
          hint="Approved, dispatched, partially received or GeM-placed POs working toward delivery. Excludes draft and pending-approval POs."
          value={erroredNoData ? null : stats.inFulfilment}
        />
        <StatCard
          icon="💰"
          tone="warn"
          label="Committed value"
          hint="Total value of POs that represent a real commitment (approved, dispatched, partially/fully received, GeM-placed). Excludes draft and cancelled POs."
          value={erroredNoData ? null : formatMoney(stats.committedMinor)}
        />
        <StatCard icon="✅" tone="good" label="Fully Received" value={erroredNoData ? null : stats.fullyReceived} />
      </StatGrid>

      <Card title="Purchase orders">
        <DataSourceBadge
          provenance={provenance ?? "live"}
          cachedAt={cachedAt}
          offline={offline}
          message={erroredNoData ? "Couldn't load — showing nothing" : undefined}
        />
        {erroredNoData ? (
          <RefreshErrorState
            error={toHumanError("load", { area: "purchase orders" })}
            backHref="/procurement"
          />
        ) : rows.length === 0 ? (
          <EmptyState icon="📦" title="No purchase orders found" message="Issue a PO to get started." />
        ) : (
          <>
            <div style={{ padding: "0 4px 10px" }}>
              <Segmented
                options={chipOptions}
                value={selectedChip}
                onChange={(label) => {
                  // Strip the trailing " (n)" count to recover the chip label.
                  const bare = label.replace(/\s*\(\d+\)\s*$/, "");
                  setStatusFilter(labelToStatus.get(bare) ?? ALL_FILTER);
                }}
              />
            </div>
            {tableRows.length === 0 ? (
              <EmptyState icon="🔍" title="No matching purchase orders" message="No POs in this status." />
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
                  { key: "status", label: "Status", cellType: "status", statusLabels: PO_STATUS_LABELS },
                ]}
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}
