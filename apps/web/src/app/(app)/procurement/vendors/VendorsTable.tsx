"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Vendor = {
  id: string;
  vendorCode: string;
  name: string;
  gstin?: string | null;
  category: string;
  empanelmentStatus: string;
  rating?: number;
  contactPerson?: string | null;
  phone?: string | null;
} & Record<string, unknown>;

const EMPANELMENT_LABELS: Record<string, string> = {
  empanelled: "Empanelled",
  provisional: "Provisional",
  blacklisted: "Blacklisted",
  not_empanelled: "Not Empanelled",
};

const PAGE_SIZE = 10;

export function VendorsTable({ vendors, source = "api" }: { vendors: Vendor[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Vendor[]>(
    "procurement.vendors",
    vendors,
    source,
    (d) => d.length === 0,
  );

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.vendorCode.toLowerCase().includes(query) ||
        (v.gstin ?? "").toLowerCase().includes(query),
    );
  }, [rows, q]);

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
    <Card title="Vendor directory">
      <div className="pad" style={{ paddingBottom: 0, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search name, code or GSTIN…"
          aria-label="Search vendors"
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
        <EmptyState icon="🏢" title="No vendors found" message="Register a vendor to get started." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>GSTIN</th>
              <th>Category</th>
              <th>Empanelment</th>
              <th className="num">Rating</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((vendor) => (
              <tr key={vendor.id} className="clickable">
                <td><span className="mono">{vendor.vendorCode}</span></td>
                <td>
                  <Link href={`/procurement/vendors/${vendor.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    {vendor.name}
                  </Link>
                </td>
                <td><span className="mono">{vendor.gstin ?? "—"}</span></td>
                <td>{vendor.category}</td>
                <td><StatusPill status={vendor.empanelmentStatus} label={EMPANELMENT_LABELS[vendor.empanelmentStatus] ?? vendor.empanelmentStatus} /></td>
                <td className="num">{vendor.rating !== undefined ? `${vendor.rating}/5` : "—"}</td>
                <td>{vendor.contactPerson ?? vendor.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
