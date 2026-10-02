"use client";

import { useState } from "react";
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

const TAB_ERROR_KEY = { Summary: "summary", "GST Ledger": "ledger", "ITC Reconciliation": "itc" } as const;

export function GstConsole({ period, summary, ledger, itc, errors = {} }: GstConsoleProps) {
  const [active, setActive] = useState<Tab>("Summary");
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
          <DataTable<LedgerRow>
            columns={[
              { key: "invoice_no", label: "Invoice No." },
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
            ]}
            rows={ledger}
            sortable
            filterable
            filterPlaceholder="Filter by invoice no., GSTIN, or party…"
            pageSize={15}
          />
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
