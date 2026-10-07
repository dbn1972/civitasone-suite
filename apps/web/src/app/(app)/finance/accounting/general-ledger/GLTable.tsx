"use client";

/**
 * General ledger table (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03): server-driven. The page fetches ONE bounded
 * page of ledger lines for the chosen fiscal year / voucher type / search (finance-service
 * GET /v1/finance/journals/lines) plus totals over the WHOLE filtered set; this component only renders it and
 * moves between pages by changing the URL (fy / type / q / page), so a tenant with a very large ledger never
 * loads it into the browser, and the cards and footer totals are filter-wide, not "this page".
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Segmented, EmptyState, StatGrid, StatCard, Card, Button } from "../../../../_components/ds";
import { journalIdOf } from "./glStats";
import { PrintDocumentLink } from "../../../../_components/PrintDocumentLink";
import type { GLEntrySummary } from "@civitasone/types";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import type { GlLinesPagination, GlLinesTotals } from "@/lib/finance/workflowTypes";
import { GL_PAGE_SIZE, GL_TABS, glQuery, glRange, type GlTab, type GlView } from "./glPage";

type GLRow = GLEntrySummary & Record<string, unknown>;

const GL_PATH = "/finance/accounting/general-ledger";

export interface GLTableProps {
  entries: GLEntrySummary[];
  pagination: GlLinesPagination;
  totals: GlLinesTotals | null;
  view: GlView;
}

export function GLTable({ entries, pagination, totals, view }: GLTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState(view.q);

  const go = (next: Partial<GlView>) => {
    // glQuery() returns "" or a leading-"?" query string; the base route is a real page.
    const qs = glQuery({ ...view, ...next });
    router.push(qs ? `${GL_PATH}${qs}` : GL_PATH);
  };
  const range = glRange(view.page, GL_PAGE_SIZE, pagination.total);
  const debit = totals ? BigInt(totals.debitMinor) : null;
  const credit = totals ? BigInt(totals.creditMinor) : null;
  const balance = totals === null || totals.entryLines === 0 ? null : debit === credit ? "balanced" : "unbalanced";
  const filtered = view.tab !== "All" || view.q !== "";

  return (
    <>
      <StatGrid>
        <StatCard icon="📒" iconBg="#e7edfd" label="Vouchers" value={totals ? totals.vouchers : "—"} />
        <StatCard icon="🧾" iconBg="#f4f3ff" label="Entry lines" value={totals ? totals.entryLines : "—"} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Accounts Active" value={totals ? totals.accountsActive : "—"} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Ledger Total Debit" value={debit !== null ? formatMoney(debit) : "—"} />
        <StatCard
          icon="📥"
          iconBg="#ecfdf3"
          label="Ledger Total Credit"
          value={credit !== null ? formatMoney(credit) : "—"}
          {...(balance === null ? {} : { delta: balance === "balanced" ? "Balanced" : "Unbalanced", up: balance === "balanced" })}
        />
      </StatGrid>
      <Card title={`General ledger · FY ${view.fy}`}>
        <div>
          <div className="dt-toolbar">
            <form
              className="dt-filter"
              role="search"
              onSubmit={(e) => { e.preventDefault(); go({ q: query.trim(), page: 1 }); }}
            >
              <span aria-hidden="true" style={{ fontSize: 13 }}>🔍</span>
              <label htmlFor="gl-search" className="sr-only">Search general ledger</label>
              <input
                id="gl-search"
                type="search"
                value={query}
                placeholder="Search voucher, account, narration…"
                aria-label="Search general ledger"
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button type="submit" variant="ghost" size="sm">Search</Button>
            </form>
            <Segmented options={[...GL_TABS]} value={view.tab} onChange={(v) => go({ tab: v as GlTab, page: 1 })} />
          </div>

          {entries.length === 0 ? (
            <EmptyState
              icon="📒"
              title={filtered ? "No entries for this filter" : `No entries in FY ${view.fy}`}
              message={filtered ? "Try changing the tab or clearing your search." : "No vouchers have been posted in this fiscal year."}
            />
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
                  key: "debit", label: "Debit", align: "right",
                  render: (e) => {
                    const val = BigInt((e.debit as string) || "0");
                    return <span aria-label={val > 0n ? `Debit ${formatMoney(val)}` : "No debit"}>{val > 0n ? formatMoney(val) : "—"}</span>;
                  },
                },
                {
                  key: "credit", label: "Credit", align: "right",
                  render: (e) => {
                    const val = BigInt((e.credit as string) || "0");
                    return <span aria-label={val > 0n ? `Credit ${formatMoney(val)}` : "No credit"}>{val > 0n ? formatMoney(val) : "—"}</span>;
                  },
                },
                {
                  key: "id", label: "Print", sortable: false,
                  render: (e) => <PrintDocumentLink href={`/api/proxy/v1/finance/journals/${journalIdOf(e.id as string)}/pdf`} label="Voucher" />,
                },
              ]}
              rows={entries as GLRow[]}
              pageSize={GL_PAGE_SIZE}
              sortable
            />
          )}

          <nav className="dt-toolbar" aria-label="General ledger pages" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)" }}>
            <span style={{ fontSize: 13, color: "var(--ink2)" }}>
              {pagination.total > 0 ? `${range.from}–${range.to} of ${pagination.total} entries` : "0 entries"}
              {totals ? <> — {filtered ? "Filtered total" : "Total"} Debit: <strong>{formatMoney(debit ?? 0n)}</strong> · Credit: <strong>{formatMoney(credit ?? 0n)}</strong></> : null}
            </span>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Button variant="ghost" size="sm" disabled={view.page <= 1} onClick={() => go({ page: view.page - 1 })}>Previous</Button>
              <span style={{ fontSize: 13 }} aria-live="polite">Page {view.page} of {range.pages}</span>
              <Button variant="ghost" size="sm" disabled={!pagination.hasMore} onClick={() => go({ page: view.page + 1 })}>Next</Button>
            </span>
          </nav>
        </div>
      </Card>
    </>
  );
}
