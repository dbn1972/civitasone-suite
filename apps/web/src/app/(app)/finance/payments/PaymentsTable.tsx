"use client";

import { useState, useMemo } from "react";
import { Card, DataTable, Segmented, StatusPill } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { formatPaymentRef, paymentAmountMinor, paymentStatusVariant } from "./paymentUi";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Payment = {
  id?: string;
  referenceId: string;
  beneficiary: string;
  amountDisplay: string;
  /** Exact paise (base-10 string) when the API supplies it. */
  amountMinor?: string;
  status: string;
};

type Row = {
  id?: string;
  reference: string;
  beneficiary: string;
  /** GAP-FINANCE-PAYMENTS-05: paise as bigint, so sorting is numeric (not text) and exact. */
  amountMinor: bigint | null;
  amountDisplay: string;
  status: string;
};

const TABS = ["All", "Pending", "Released"] as const;
type Tab = (typeof TABS)[number];

/**
 * GAP-FINANCE-TREASURY-E-PAYMENTS-01: /finance/treasury/e-payments reads the same dataset as this register, so it
 * renders THIS table (same reference, same exact-paise amount, same tabs, same row links) instead of a second copy
 * that showed the raw reference and sorted the amount as text. The few knobs below are the only differences between
 * the two screens: their own offline-cache key, headings and CSV export.
 */
export interface PaymentsTableLabels {
  title?: string;
  searchPlaceholder?: string;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyMessage?: string;
}

export function PaymentsTable({
  payments,
  source = "api",
  cacheKey = "finance.payments",
  labels = {},
  exportConfig,
}: {
  payments: Payment[];
  source?: "api" | "error";
  /** Offline-cache key for the rows (each screen keeps its own). */
  cacheKey?: string;
  labels?: PaymentsTableLabels;
  /** Opt-in audited CSV export (`audit` is the server-safe resource key). The register has none. */
  exportConfig?: { audit: string; filename: string };
}) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Payment[]>(
    cacheKey,
    payments,
    source,
    (d) => d.length === 0,
  );

  const filtered = rows.filter((p) => {
    if (activeTab === "Pending") return p.status === "Pending Approval";
    if (activeTab === "Released") return p.status === "Released";
    return true;
  });

  const tableRows: Row[] = useMemo(
    () =>
      filtered.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        reference: formatPaymentRef(p.referenceId),
        beneficiary: p.beneficiary,
        amountMinor: paymentAmountMinor(p),
        amountDisplay: p.amountDisplay,
        status: p.status,
      })),
    [filtered],
  );

  return (
    <Card
      title={labels.title ?? "Payments register"}
      link={
        <Segmented
          options={[...TABS]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as Tab)}
        />
      }
    >
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "reference", label: "Reference" },
          { key: "beneficiary", label: "Beneficiary" },
          {
            key: "amountMinor",
            label: "Amount",
            align: "right",
            // Sort on paise; show the formatted amount (falls back to the API's own
            // display string only when no numeric value could be derived).
            render: (row) => (row.amountMinor !== null ? formatMoney(row.amountMinor) : row.amountDisplay),
            // The CSV carries what the screen shows (exact paise through formatMoney), not the raw paise integer.
            csv: (row) => (row.amountMinor !== null ? String(formatMoney(row.amountMinor)) : row.amountDisplay),
          },
          {
            key: "status",
            label: "Status",
            // Released = money out (green); see paymentUi.ts for why the global map is not used.
            render: (row) => <StatusPill status={row.status} variant={paymentStatusVariant(row.status)} />,
          },
        ]}
        rows={tableRows}
        // Open the payment detail (UTR, submit-for-approval) — only for rows
        // that carry a real id; id-less rows stay non-clickable (no dead link).
        rowHref={(row) => (row.id ? `/finance/payments/${row.id}` : "")}
        sortable
        filterable
        filterPlaceholder={labels.searchPlaceholder ?? "Search payments…"}
        pageSize={15}
        {...(exportConfig ? { exportable: true, exportAudit: exportConfig.audit, exportFilename: exportConfig.filename } : {})}
        {...(labels.emptyIcon ? { emptyIcon: labels.emptyIcon } : {})}
        {...(labels.emptyTitle ? { emptyTitle: labels.emptyTitle } : {})}
        {...(labels.emptyMessage ? { emptyMessage: labels.emptyMessage } : {})}
      />
    </Card>
  );
}
