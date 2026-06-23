"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

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

const PAGE_SIZE = 10;

/** Client-side search + vendor filter + pagination so the list works fully
 * offline from the cached row set (server provides up to 500 rows). */
export function OrdersTable({ orders, source = "api" }: { orders: Order[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Order[]>(
    "procurement.orders",
    orders,
    source,
    (d) => d.length === 0,
  );

  const [q, setQ] = useState("");
  const [vendor, setVendor] = useState("");
  const [page, setPage] = useState(1);

  const vendors = useMemo(() => [...new Set(rows.map((o) => o.vendor))].sort(), [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((o) => {
      const matchesQ = query === "" || o.poNo.toLowerCase().includes(query) || o.vendor.toLowerCase().includes(query);
      const matchesVendor = vendor === "" || o.vendor.toLowerCase().includes(vendor.toLowerCase());
      return matchesQ && matchesVendor;
    });
  }, [rows, q, vendor]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(safePage * PAGE_SIZE, filtered.length);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card
      title="Purchase orders"
      link={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={vendor}
            onChange={(e) => { setVendor(e.target.value); setPage(1); }}
            style={{ fontSize: "0.8rem", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "4px 8px", background: "#fff" }}
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      }
    >
      <div className="pad" style={{ paddingBottom: 0, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search PO no or vendor…"
          aria-label="Search purchase orders"
          style={{ flex: 1, minWidth: 220, fontSize: "0.8rem", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8rem", color: "#64748b" }}>
          <span>{from}–{to} of {filtered.length}</span>
          <button type="button" className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 8px", opacity: safePage > 1 ? 1 : 0.4 }} disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>Page {safePage}/{pageCount}</span>
          <button type="button" className="btn ghost" style={{ fontSize: "0.75rem", padding: "4px 8px", opacity: safePage < pageCount ? 1 : 0.4 }} disabled={safePage >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {pageRows.length === 0 ? (
        <EmptyState icon="📦" title="No purchase orders found" message="Issue a PO to get started." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>PO No</th>
              <th>Vendor</th>
              <th className="num">Amount</th>
              <th>Order Date</th>
              <th>Delivery Date</th>
              <th>GRN Status</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((order) => (
              <tr key={order.id} className="clickable">
                <td>
                  <Link href={`/procurement/orders/${order.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <span className="mono">{order.poNo}</span>
                  </Link>
                </td>
                <td>{order.vendor}</td>
                <td className="num">₹{(order.amount / 100).toLocaleString("en-IN")}</td>
                <td>{order.orderDate}</td>
                <td>{order.deliveryDate ?? "—"}</td>
                <td>{order.grnStatus ?? "—"}</td>
                <td><StatusPill status={order.status} label={STATUS_LABELS[order.status] ?? order.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
