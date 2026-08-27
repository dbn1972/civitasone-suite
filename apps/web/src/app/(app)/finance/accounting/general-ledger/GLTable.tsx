"use client";

import { useMemo, useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../../_components/ds";
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

type GLRow = GLEntrySummary & Record<string, unknown>;

export function GLTable({ entries, source = "api" }: GLTableProps) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const [query, setQuery] = useState("");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GLEntrySummary[]>(
    "finance.glEntries",
    entries,
    source,
    (d) => d.length === 0,
  );

  const filtered = useMemo((): GLRow[] => {
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
    }) as GLRow[];
  }, [rows, activeTab, query]);

  // debit/credit are minor-unit (paise) decimal strings — sum as BigInt so
  // formatMoney() (which expects minor units) renders the right scale and
  // large ledgers don't drift under float addition.
  const totalDebit = filtered.reduce((s, e) => s + BigInt((e.debit as string) || "0"), 0n);
  const totalCredit = filtered.reduce((s, e) => s + BigInt((e.credit as string) || "0"), 0n);

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
          <label htmlFor="gl-search" className="sr-only">Search general ledger</label>
          <input
            id="gl-search"
            type="text"
            value={query}
            placeholder="Search voucher, account, narration…"
            aria-label="Search general ledger"
            onChange={(e) => { setQuery(e.target.value); }}
          />
        </div>
        <Segmented
          options={[...TABS]}
          value={activeTab}
          onChange={(v) => { setActiveTab(v as Tab); }}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📒" title="No entries for this filter" message="Try changing the tab or clearing your search." />
      ) : (
        <DataTable<GLRow>
          columns={[
            { key: "voucherNo", label: "Voucher", render: (e) => <span className="mono">{e.voucherNo as string}</span> },
            { key: "date", label: "Date", render: (e) => formatIndianDate(e.date as string) },
            { key: "accountCode", label: "Account", render: (e) => <span className="mono">{e.accountCode as string}</span> },
            { key: "accountName", label: "Account Name" },
            { key: "narration", label: "Narration", render: (e) => (e.narration as string | null) ?? "—" },
            { key: "referenceNo", label: "Ref", render: (e) => (e.referenceNo as string | null) ?? "—" },
            {
              key: "debit",
              label: "Debit",
              align: "right",
              render: (e) => {
                const val = BigInt((e.debit as string) || "0");
                return (
                  <span aria-label={val > 0n ? `Debit ${formatMoney(val)}` : "No debit"}>
                    {val > 0n ? formatMoney(val) : "—"}
                  </span>
                );
              },
            },
            {
              key: "credit",
              label: "Credit",
              align: "right",
              render: (e) => {
                const val = BigInt((e.credit as string) || "0");
                return (
                  <span aria-label={val > 0n ? `Credit ${formatMoney(val)}` : "No credit"}>
                    {val > 0n ? formatMoney(val) : "—"}
                  </span>
                );
              },
            },
            {
              key: "id",
              label: "Print",
              sortable: false,
              render: (e) => {
                const journalId = (e.id as string).includes(":") ? (e.id as string).split(":")[0] : (e.id as string);
                return (
                  <PrintDocumentLink
                    href={`/api/proxy/v1/finance/journals/${journalId}/pdf`}
                    label="Voucher"
                  />
                );
              },
            },
          ]}
          rows={filtered}
          pageSize={PAGE_SIZE}
          sortable
        />
      )}

      {filtered.length > 0 && (
        <div className="dt-toolbar" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--line)" }}>
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>
            Total ({filtered.length} entries) — Debit: <strong>{formatMoney(totalDebit)}</strong> · Credit: <strong>{formatMoney(totalCredit)}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
