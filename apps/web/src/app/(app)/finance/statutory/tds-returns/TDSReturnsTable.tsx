"use client";
import { DataTable, RevealableValue, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { VendorTdsEntry } from "@civitasone/types";
type Row = VendorTdsEntry;
/** finance-service's vendor-tds/:id/pan/reveal requires a reason of 10 to 500 characters. */
const TDS_REVEAL_REASON_MIN = 10;
const TDS_REVEAL_REASON_MAX = 500;
/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-05: the PAN column shows the server-masked value (ABCDE****F). Rows reach
 * this table already masked (page.tsx), so the full PAN is never in the DOM, the offline cache or the CSV export.
 * A viewer who may see it (`canReveal`) gets a Reveal control that asks for a reason and calls the audited
 * POST /v1/finance/vendor-tds/:id/pan/reveal; the audit event is published before the clear value comes back,
 * and the value re-masks itself after 30 seconds. The clear value is held in component state only.
 */
export function TDSReturnsTable({ returns, source = "api", canReveal = false }: { returns: Row[]; source?: "api" | "error"; canReveal?: boolean }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.tds-returns", returns, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "vendor_name", label: "Vendor" },
          {
            key: "pan",
            label: "PAN",
            render: (row: Row) =>
              // No control at all (not even a hidden one) for a viewer who may not reveal, or a row with no PAN.
              canReveal && row.pan ? (
                <RevealableValue
                  maskedText={row.pan}
                  revealPath={`v1/finance/vendor-tds/${encodeURIComponent(row.id)}/pan/reveal`}
                  pick={(json) => (json as { pan?: string | null } | null)?.pan}
                  canReveal
                  label="PAN"
                  context={row.vendor_name}
                  minReasonLength={TDS_REVEAL_REASON_MIN}
                  maxReasonLength={TDS_REVEAL_REASON_MAX}
                />
              ) : (
                <span style={{ fontFamily: "monospace" }}>{row.pan ?? "—"}</span>
              ),
          },
          { key: "section", label: "Section" },
          { key: "quarter", label: "Quarter" },
          { key: "fy", label: "FY" },
          { key: "tds_amount_minor", label: "Total TDS", align: "right", cellType: "amount" },
          { key: "deduction_date", label: "Deduction Date", cellType: "date" },
          // "filed" is the final, successful state of a deduction; the global pill map keeps
          // it amber for RTI/appeals, so the good tone is set here (TDS-RETURNS-06).
          { key: "status", label: "Status", render: (row: Row) => <StatusPill status={String(row.status)} variant={String(row.status) === "filed" ? "good" : undefined} /> },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search TDS deductions…"
        pageSize={15}
        exportable exportAudit="finance/statutory/tds-returns"
        exportFilename="tds-deductions"
        emptyIcon="📑"
        emptyTitle="No TDS deductions"
        emptyMessage="No vendor TDS deductions found."
      />
    </>
  );
}
