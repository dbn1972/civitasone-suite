"use client";

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { DataTable, Tabs, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import type { SummaryRow, LedgerRow, ItcRow } from "./types";

const TABS = ["Summary", "GST Ledger", "ITC Reconciliation"] as const;
type Tab = (typeof TABS)[number];

interface GstConsoleProps {
  period: string;
  summary: SummaryRow[];
  ledger: LedgerRow[];
  itc: ItcRow[];
  /** Per-source load failure flags (GAP-FINANCE-GST-01): a failed fetch is not an empty period. */
  errors?: { summary?: boolean; ledger?: boolean; itc?: boolean };
}

/** GAP-FINANCE-GST-05: link target of a ledger row's invoice number, or null when none is verified. */
export function invoiceHref(r: Pick<LedgerRow, "invoice_id" | "invoice_is_bill">): string | null {
  return r.invoice_is_bill === true && r.invoice_id ? `/finance/expenditure/bills/${encodeURIComponent(r.invoice_id)}` : null;
}

/** Ledger columns; HSN, Rate and Status are the low-priority ones (GAP-FINANCE-GST-05). */
type LedgerColumn = ComponentProps<typeof DataTable<LedgerRow>>["columns"][number];

export function ledgerColumns(all: boolean): LedgerColumn[] {
  const cols: LedgerColumn[] = [
    {
      key: "invoice_no",
      label: "Invoice No.",
      // Linked to the source bill only when the server confirmed invoice_id is a real bill.
      render: (r: LedgerRow) => {
        const href = invoiceHref(r);
        return href ? <Link href={href}>{r.invoice_no}</Link> : r.invoice_no;
      },
      csv: (r: LedgerRow) => String(r.invoice_no ?? ""),
    },
    { key: "invoice_date", label: "Invoice Date" },
    { key: "party_gstin", label: "Party GSTIN" },
    { key: "party_name", label: "Party Name" },
    { key: "direction", label: "Direction", cellType: "status" },
    { key: "gst_type", label: "GST Type" },
    { key: "hsn_code", label: "HSN" },
    { key: "rate_pct", label: "Rate %", align: "right" },
    { key: "taxable_minor", label: "Taxable Value", align: "right", cellType: "amount" },
    { key: "tax_minor", label: "Tax", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];
  return all ? cols : cols.filter((c) => !["hsn_code", "rate_pct", "status"].includes(String(c.key)));
}

/**
 * GAP-FINANCE-GST-05: the CSV export lists party GSTINs, so each export is
 * recorded server-side (finance-service POST /v1/finance/gst/ledger/export-audit).
 * Fire-and-forget: audit recording never blocks the user's own download.
 */
export async function recordGstLedgerExport(period: string, info: { rowCount: number; filter: string }): Promise<void> {
  await fetch("/api/proxy/v1/finance/gst/ledger/export-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ period, rowCount: info.rowCount, filtered: info.filter.trim().length > 0 }),
  });
}

const TAB_ERROR_KEY = { Summary: "summary", "GST Ledger": "ledger", "ITC Reconciliation": "itc" } as const;

export function GstConsole({ period, summary, ledger, itc, errors = {} }: GstConsoleProps) {
  const [active, setActive] = useState<Tab>("Summary");
  // GAP-FINANCE-GST-05: 11 columns is too wide to scan, so the low-priority
  // ones (HSN, Rate, Status) sit behind a "Show all columns" toggle.
  const [allColumns, setAllColumns] = useState(false);
  // Tabs identify by their label string, so a warning cue on a failed tab is
  // added to the label and mapped back to the tab id on change.
  const labelOf = (t: Tab) => (errors[TAB_ERROR_KEY[t]] ? `${t} ⚠` : t);
  const failedState = (area: string) => (
    <RefreshErrorState error={toHumanError("load", { area })} backHref="/finance" />
  );

  return (
    <div>
      <Tabs
        tabs={TABS.map(labelOf)}
        active={labelOf(active)}
        onChange={(label) => { const t = TABS.find((x) => labelOf(x) === label); if (t) setActive(t); }}
      />

      {active === "Summary" && (
        errors.summary ? failedState("GST summary") : summary.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No GST summary for this period"
            message={`No output or input tax transactions were recorded for ${period}.`}
          />
        ) : (
          <DataTable<SummaryRow>
            columns={[
              { key: "direction", label: "Direction", cellType: "status" },
              { key: "gst_type", label: "GST Type" },
              { key: "total_taxable", label: "Taxable Value", align: "right", cellType: "amount" },
              { key: "total_tax", label: "Tax", align: "right", cellType: "amount" },
              { key: "transaction_count", label: "Transactions", align: "right" },
            ]}
            rows={summary}
            sortable
            pageSize={15}
          />
        )
      )}

      {active === "GST Ledger" && (
        errors.ledger ? failedState("GST ledger") : ledger.length === 0 ? (
          <EmptyState
            icon="📒"
            title="No GST ledger entries for this period"
            message="No invoices with GST were recorded for the selected period."
          />
        ) : (
          <>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, margin: "0 0 8px" }}>
              <input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} />
              Show all columns (HSN, rate, status)
            </label>
            <DataTable<LedgerRow>
              columns={ledgerColumns(allColumns)}
              rows={ledger}
              sortable
              filterable
              filterPlaceholder="Filter by invoice no., GSTIN, or party…"
              exportable
              exportFilename={`gst-ledger-${period}`}
              exportConfirm={{
                title: "Export GST ledger?",
                description: `The file lists party GSTINs, invoice numbers and tax values for ${period}. Each export is recorded in the audit trail.`,
                confirmLabel: "Export CSV",
              }}
              onExport={(info) => { void recordGstLedgerExport(period, info).catch(() => undefined); }}
              pageSize={15}
            />
          </>
        )
      )}

      {active === "ITC Reconciliation" && (
        errors.itc ? failedState("ITC reconciliation") : itc.length === 0 ? (
          <EmptyState
            icon="🔄"
            title="No ITC reconciliation for this period"
            message="No output liability or input tax credit was recorded for the selected period."
          />
        ) : (
          <DataTable<ItcRow>
            columns={[
              { key: "gst_type", label: "GST Type" },
              { key: "itc_available", label: "ITC Available", align: "right", cellType: "amount" },
              { key: "output_liability", label: "Output Liability", align: "right", cellType: "amount" },
              { key: "net_payable", label: "Net Payable", align: "right", cellType: "amount" },
            ]}
            rows={itc}
            sortable
            pageSize={15}
          />
        )
      )}
    </div>
  );
}
