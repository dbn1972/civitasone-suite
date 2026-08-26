"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, StatusPill, DataTable, EmptyState, ErrorState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type DispatchRow = {
  id: string;
  dispatchNo: string;
  toAddress: string;
  subject: string;
  mode: string;
  status: string;
  fileId?: string | null;
  dispatchedAt?: string | null;
};

export default function DispatchRegistryPage() {
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/proxy/v1/estab/dispatch?limit=100", { signal });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { data?: DispatchRow[] };
      setRows(body.data ?? []);
    } catch (e) {
      // Ignore aborts (unmount / re-fetch). A real failure must surface as an
      // error state — never be re-thrown (unhandled rejection) nor left to show
      // the empty "No dispatches yet" state, which would read as "none exist".
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load]);

  return (
    <>
      <PageHeader
        title="Outward Dispatch Register"
        subtitle="Track dispatches linked to eOffice files."
        back="/estab/list"
      />
      <div className="card">
        <div className="card-h"><h3>Dispatch register</h3></div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
        ) : error ? (
          <div className="pad"><ErrorState error={toHumanError("load", { area: "dispatch register" })} onRetry={() => void load()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📮" title="No dispatches yet" message="Outward dispatches linked to eOffice files will appear here." />
        ) : (
          <DataTable<DispatchRow>
            columns={[
              { key: "dispatchNo", label: "Dispatch No", render: (r) => <span className="mono">{r.dispatchNo}</span> },
              { key: "toAddress", label: "To" },
              { key: "subject", label: "Subject" },
              { key: "mode", label: "Mode" },
              { key: "dispatchedAt", label: "Date", render: (r) => <>{formatIndianDate(r.dispatchedAt)}</> },
              { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} label={r.status.replace(/_/g, " ")} /> },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter dispatches…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
