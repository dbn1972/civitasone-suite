"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { maskPan } from "@/app/_components/ds/Masked";
import { gstinCell } from "./vendorStats";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { browserFetch } from "@/lib/api/browserClient";
import { Button } from "@/app/_components/ds";
import { workflowErrorMessage } from "@/lib/finance/workflowErrors";
import type { FinanceVendorSummary } from "@civitasone/types";

// DataTable's generic requires an index signature; FinanceVendorSummary is a
// plain named type. Intersection satisfies the constraint without widening
// away real field names/types.
type Row = FinanceVendorSummary & Record<string, unknown>;

export function VendorsTable({ vendors, source = "api", canExport = false }: { vendors: FinanceVendorSummary[]; source?: "api" | "error"; canExport?: boolean }) {
  const t = useTranslations("financeVendorExport");
  const te = useTranslations("financeWorkflowErrors");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  // GAP-FINANCE-VENDORS-02: the export is SERVER-authoritative. The server writes the audit event first and only
  // then returns the CSV (built from the masked list), so it cannot be skipped by a client and a failure is shown,
  // never swallowed.
  async function exportRegister() {
    setExporting(true);
    setExportError("");
    try {
      const res = await browserFetch("v1/finance/vendors/export", { method: "POST", body: "{}" });
      if (!res.ok) { setExportError(await workflowErrorMessage(res, (k) => te(k), "load", "vendor register")); return; }
      const { csv } = (await res.json()) as { csv: string };
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "vendor-master.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(t("failed"));
    } finally {
      setExporting(false);
    }
  }
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.vendors", vendors as Row[], source, (d) => d.length === 0);
  return (
    <>
      {/* UX-002: single source of truth — reads the same useSeededResource
          call as `rows`, so it can never contradict this table. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {canExport ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", marginBottom: 8 }}>
          {exportError ? <span role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{exportError}</span> : null}
          <Button variant="ghost" size="sm" onClick={() => void exportRegister()} disabled={exporting} aria-busy={exporting}>
            {exporting ? t("exporting") : t("button")}
          </Button>
        </div>
      ) : null}
      <DataTable<Row>
        columns={[
          { key: "name", label: "Vendor Name" },
          { key: "pan", label: "PAN" },
          { key: "gstin", label: "GSTIN" },
          { key: "category", label: "Category" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        // PAN is a DPDP identifier: mask it in the cell AND in the CSV export
        // (DataTable writes the row value), GAP-FINANCE-VENDORS-02.
        // GSTIN: a blank cell reads as missing data; say "Unregistered" (also in the CSV export).
        rows={rows.map((r) => ({ ...r, pan: r.pan ? maskPan(String(r.pan)) : r.pan, gstin: gstinCell(r.gstin as string | null | undefined) }))}
        rowLinkKey="id"
        rowLinkPrefix="/finance/vendors/"
        sortable
        filterable
        filterPlaceholder="Search vendors…"
        pageSize={15}
        // The table has no built-in export: the register export goes through the audited server endpoint above.
        emptyIcon="🏢"
        emptyTitle="No vendors"
        emptyMessage="No vendors registered yet."
      />
    </>
  );
}
