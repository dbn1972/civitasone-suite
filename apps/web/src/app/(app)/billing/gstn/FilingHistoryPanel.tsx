"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, DataTable, EmptyState } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatShortId } from "@/lib/formatters";

/**
 * GAP-BILLING-GSTN-05 (UAT B4): what has already been filed. Reads the billing-service filing
 * history (GET v1/billing/gstn/returns, tenant-scoped, local data only) so an officer can see
 * the returns filed for a period before filing again. Rows open the Return Status tab.
 */
export interface FiledReturn {
  id: string;
  gstin: string;
  returnPeriod: string;
  returnType: string;
  referenceId: string;
  status: string;
  totalTaxableMinor: string;
  totalCgstMinor: string;
  totalSgstMinor: string;
  totalIgstMinor: string;
  filedAt: string;
}

interface Row extends Record<string, unknown> {
  id: string;
  returnPeriod: string;
  returnType: string;
  gstin: string;
  referenceShort: string;
  status: string;
  totalTaxableMinor: string;
  filedAt: string;
}

export function FilingHistoryPanel({ onOpenStatus, refreshKey = 0 }: { onOpenStatus?: (referenceId: string) => void; refreshKey?: number }) {
  const [rows, setRows] = useState<FiledReturn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await browserFetch("v1/billing/gstn/returns?limit=100");
      if (!res.ok) {
        setError(await errorMessageFromResponse(res));
        return;
      }
      const body = (await res.json()) as { data?: FiledReturn[] };
      setRows(Array.isArray(body.data) ? body.data : []);
    } catch {
      setError("Network error. Please try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <div role="alert" className="card">
        <p style={{ margin: 0 }}>{error}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>
      </div>
    );
  }
  if (rows === null) return <p role="status">Loading filing history…</p>;
  if (rows.length === 0) {
    return <EmptyState icon="🗂️" title="No returns filed yet" message="Returns you file from the Submit Return tab will be listed here." />;
  }

  const tableRows: Row[] = rows.map((r) => ({
    id: r.id,
    returnPeriod: r.returnPeriod,
    returnType: r.returnType,
    gstin: r.gstin,
    referenceShort: formatShortId(r.referenceId),
    status: r.status,
    totalTaxableMinor: r.totalTaxableMinor,
    filedAt: r.filedAt,
  }));
  const refById = new Map(rows.map((r) => [r.id, r.referenceId]));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <DataTable<Row>
        columns={[
          { key: "returnPeriod", label: "Period" },
          { key: "returnType", label: "Return" },
          { key: "gstin", label: "GSTIN" },
          { key: "referenceShort", label: "Reference" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "totalTaxableMinor", label: "Taxable value", align: "right", cellType: "money" },
          { key: "filedAt", label: "Filed on", cellType: "datetime" },
        ]}
        rows={tableRows}
        identifyingColumnKey="returnPeriod"
        sortable
        filterable
        filterPlaceholder="Filter by period, return, GSTIN or status…"
        pageSize={15}
        emptyIcon="🗂️"
        emptyTitle="No returns filed yet"
        emptyMessage="Returns you file from the Submit Return tab will be listed here."
      />
      {onOpenStatus && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {rows.slice(0, 5).map((r) => (
            <Button key={r.id} type="button" variant="ghost" size="sm" onClick={() => onOpenStatus(refById.get(r.id) ?? r.referenceId)}>
              Check status: {r.returnType} {r.returnPeriod}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
