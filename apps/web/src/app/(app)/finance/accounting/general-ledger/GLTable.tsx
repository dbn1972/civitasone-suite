"use client";

import { useState } from "react";
import { Segmented } from "../../../../_components/ds";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import type { GLEntrySummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

const TABS = ["All", "Payment", "Receipt", "Journal"] as const;
type Tab = (typeof TABS)[number];

const TAB_TYPE_MAP: Record<Tab, "payment" | "receipt" | "journal" | null> = {
  All: null,
  Payment: "payment",
  Receipt: "receipt",
  Journal: "journal",
};

interface GLTableProps {
  entries: GLEntrySummary[];
  source?: "api" | "error";
}

export function GLTable({ entries, source = "api" }: GLTableProps) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GLEntrySummary[]>(
    "finance.glEntries",
    entries,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    TAB_TYPE_MAP[activeTab] === null
      ? rows
      : rows.filter((e) => e.type === TAB_TYPE_MAP[activeTab]);

  const totalDebit = filtered.reduce((s, e) => s + e.debit, 0);
  const totalCredit = filtered.reduce((s, e) => s + e.credit, 0);

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
      <div className="card-h" style={{ marginBottom: "1rem" }}>
        <span />
        <Segmented
          options={[...TABS]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as Tab)}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
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
            {filtered.map((e) => {
              const journalId = e.id.includes(":") ? e.id.split(":")[0] : e.id;
              return (
              <tr key={e.id}>
                <td>
                  <span className="mono">{e.voucherNo}</span>
                </td>
                <td>{formatIndianDate(e.date)}</td>
                <td>
                  <span className="mono">{e.accountCode}</span>
                </td>
                <td>{e.accountName}</td>
                <td>{e.narration ?? "—"}</td>
                <td>{e.referenceNo ?? "—"}</td>
                <td className="num">
                  {e.debit > 0 ? `₹${(e.debit / 100).toLocaleString("en-IN")}` : "—"}
                </td>
                <td className="num">
                  {e.credit > 0 ? `₹${(e.credit / 100).toLocaleString("en-IN")}` : "—"}
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
              <td colSpan={7}>
                <strong>Total ({filtered.length} entries)</strong>
              </td>
              <td className="num">
                <strong>₹{(totalDebit / 100).toLocaleString("en-IN")}</strong>
              </td>
              <td className="num">
                <strong>₹{(totalCredit / 100).toLocaleString("en-IN")}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
