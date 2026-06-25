"use client";

import { useMemo, useState } from "react";
import { Segmented } from "../../../../_components/ds";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import type { GLEntrySummary } from "@civitasone/types";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

const TABS = ["All", "Payment", "Receipt", "Journal"] as const;
type Tab = (typeof TABS)[number];

const TAB_TYPE_MAP: Record<Tab, "payment" | "receipt" | "journal" | null> = {
  All: null,
  Payment: "payment",
  Receipt: "receipt",
  Journal: "journal",
};

const PAGE_SIZE = 25;

interface GLTableProps {
  entries: GLEntrySummary[];
  source?: "api" | "error";
}

export function GLTable({ entries, source = "api" }: GLTableProps) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GLEntrySummary[]>(
    "finance.glEntries",
    entries,
    source,
    (d) => d.length === 0,
  );

  const filtered = useMemo(() => {
    const typeFilter = TAB_TYPE_MAP[activeTab];
    const q = query.trim().toLowerCase();
    return rows.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (!q) return true;
      return (
        e.voucherNo.toLowerCase().includes(q) ||
        e.accountCode.toLowerCase().includes(q) ||
        e.accountName.toLowerCase().includes(q) ||
        (e.narration ?? "").toLowerCase().includes(q) ||
        (e.referenceNo ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, activeTab, query]);

  const totalDebit = filtered.reduce((s, e) => s + e.debit, 0);
  const totalCredit = filtered.reduce((s, e) => s + e.credit, 0);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <div className="dt-toolbar">
        <div className="dt-filter">
          <span aria-hidden="true" style={{ fontSize: 13 }}>🔍</span>
          <input
            type="text"
            value={query}
            placeholder="Search voucher, account, narration…"
            aria-label="Search general ledger"
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          />
        </div>
        <Segmented
          options={[...TABS]}
          value={activeTab}
          onChange={(v) => { setActiveTab(v as Tab); setPage(0); }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink2)" }}>
          No entries for this filter.
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Voucher</th>
              <th>Date</th>
              <th>Account</th>
              <th>Account Name</th>
              <th>Narration</th>
              <th>Ref</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th>Print</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const journalId = e.id.includes(":") ? e.id.split(":")[0] : e.id;
              return (
              <tr key={e.id}>
                <td><span className="mono">{e.voucherNo}</span></td>
                <td>{formatIndianDate(e.date)}</td>
                <td><span className="mono">{e.accountCode}</span></td>
                <td>{e.accountName}</td>
                <td>{e.narration ?? "—"}</td>
                <td>{e.referenceNo ?? "—"}</td>
                <td className="num" aria-label={e.debit > 0 ? `Debit ${formatMoney(e.debit)}` : "No debit"}>
                  {e.debit > 0 ? formatMoney(e.debit) : "—"}
                </td>
                <td className="num" aria-label={e.credit > 0 ? `Credit ${formatMoney(e.credit)}` : "No credit"}>
                  {e.credit > 0 ? formatMoney(e.credit) : "—"}
                </td>
                <td>
                  <PrintDocumentLink
                    href={`/api/proxy/v1/finance/journals/${journalId}/pdf`}
                    label="Voucher"
                  />
                </td>
              </tr>
            );})}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}><strong>Total ({filtered.length} entries)</strong></td>
              <td className="num"><strong>{formatMoney(totalDebit)}</strong></td>
              <td className="num"><strong>{formatMoney(totalCredit)}</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="dt-pager">
          <button type="button" className="btn ghost sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Prev</button>
          <span aria-live="polite">Page {safePage + 1} of {pageCount}<span className="sr-only"> ({filtered.length} entries)</span></span>
          <button type="button" className="btn ghost sm" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next →</button>
        </div>
      )}
    </div>
  );
}
