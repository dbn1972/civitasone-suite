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
  CLOSED_PO_STATUSES,
  ACTIVE_PO_STATUSES,
  ACTIVE_PO_FILTER,
  isDeliveryOverdue,
} from "@/lib/procurement-status";

/** Translated copy the server page passes in (English defaults keep the component usable on its own). */
export type OrdersTableLabels = { completedValue: string; completedValueHint: string; activeFilter: string };
const DEFAULT_LABELS: OrdersTableLabels = {
  completedValue: "Completed (closed) value",
  completedValueHint: "Total value of POs fulfilled and closed. Their value has moved from committed to actual expenditure, so it is not part of Committed value.",
  activeFilter: "Active",
};

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
const IN_FULFILMENT_STATUSES = new Set<string>(ACTIVE_PO_STATUSES);

const ALL_FILTER = "All";

export function OrdersTable({
  orders,
  source = "api",
  initialStatus,
  labels = DEFAULT_LABELS,
}: {
  orders: Order[];
  source?: "api" | "error";
  /** A PO status key to open the list narrowed to (e.g. from a dashboard drill-through), or "active". */
  initialStatus?: string;
  labels?: OrdersTableLabels;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Order[]>(
    "procurement.orders",
    orders,
    source,
    (d) => d.length === 0,
  );

  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus && (initialStatus in PO_STATUS_LABELS || initialStatus === ACTIVE_PO_FILTER) ? initialStatus : ALL_FILTER,
  );

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
    // UAT Phase 2: fulfilled + closed POs are valued on their own tile (actual, not committed).
    const closedMinor = rows
      .filter((o) => CLOSED_PO_STATUSES.has(o.status))
      .reduce((s, o) => s + (Number.isFinite(o.amount) ? Math.round(o.amount) : 0), 0);
    return { totalPos, inFulfilment, fullyReceived, committedMinor, closedMinor };
  }, [rows]);

  // GAP-PROCUREMENT-ORDERS-04: per-status counts drive the filter chips.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of rows) counts[o.status] = (counts[o.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  const chipOptions = useMemo(() => {
    // The active filter's chip is always offered (even at a count of 0, e.g. a
    // drill-through into a status nothing is in) so it can be seen and cleared.
    const present = Object.keys(PO_STATUS_LABELS).filter((k) => (statusCounts[k] ?? 0) > 0 || k === statusFilter);
    return [
      `${ALL_FILTER} (${rows.length})`,
      // UAT Phase 2: the dashboard "Active POs" drill-through (?status=active).
      ...(statusFilter === ACTIVE_PO_FILTER ? [`${labels.activeFilter} (${stats.inFulfilment})`] : []),
      ...present.map((k) => `${PO_STATUS_LABELS[k]} (${statusCounts[k] ?? 0})`),
    ];
  }, [statusCounts, rows.length, statusFilter, labels.activeFilter, stats.inFulfilment]);

  // Map a chip label back to the status key it filters on (or ALL).
  const labelToStatus = useMemo(() => {
    const m = new Map<string, string>();
    m.set(ALL_FILTER, ALL_FILTER);
    m.set(labels.activeFilter, ACTIVE_PO_FILTER);
    for (const [key, label] of Object.entries(PO_STATUS_LABELS)) m.set(label, key);
    return m;
  }, [labels.activeFilter]);

  const selectedChip = useMemo(() => {
    if (statusFilter === ALL_FILTER) return `${ALL_FILTER} (${rows.length})`;
    if (statusFilter === ACTIVE_PO_FILTER) return `${labels.activeFilter} (${stats.inFulfilment})`;
    const label = PO_STATUS_LABELS[statusFilter];
    return `${label} (${statusCounts[statusFilter] ?? 0})`;
  }, [statusFilter, statusCounts, rows.length, labels.activeFilter, stats.inFulfilment]);

  const today = todayIST();

  const tableRows = useMemo<OrderRow[]>(() => {
    const filtered = statusFilter === ALL_FILTER
      ? rows
      : statusFilter === ACTIVE_PO_FILTER
        ? rows.filter((o) => IN_FULFILMENT_STATUSES.has(o.status))
        : rows.filter((o) => o.status === statusFilter);
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
          hint="Total value of POs that represent a real commitment (approved, dispatched, partially/fully received, GeM-placed). Excludes draft, pending-approval, cancelled and closed POs."
          value={erroredNoData ? null : formatMoney(stats.committedMinor)}
        />
        <StatCard
          icon="📁"
          tone="info"
          label={labels.completedValue}
          hint={labels.completedValueHint}
          value={erroredNoData ? null : formatMoney(stats.closedMinor)}
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
